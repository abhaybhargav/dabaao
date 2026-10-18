/// <reference lib="webworker" />
// All decoding, resizing, encoding and PDF assembly runs here, off the main thread.
// Files exist only in this worker's memory and are dropped on release()/clear().
import * as Comlink from "comlink";
import Pica from "pica";
import encodeJpeg from "@jsquash/jpeg/encode";
import { PDFDocument, PDFRawStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";
import { zipSync, zlibSync } from "fflate";
import qpdfWasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import { setJpegDpi } from "../lib/jfif";
import { searchQuality } from "../lib/search";
import type { Colour } from "../presets";

type Raster = { data: Uint8ClampedArray; width: number; height: number };

const images = new Map<string, Raster>();
const pica = Pica({ features: ["js", "wasm"] });

const MAX_PIXELS = 36_000_000;
const PREVIEW_EDGE = 1024;

// ---------- decode ----------

async function rasterFromBitmap(bmp: ImageBitmap): Promise<Raster> {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; // flatten transparency onto white
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { data: img.data, width: img.width, height: img.height };
}

async function decodeHeic(buf: ArrayBuffer): Promise<Raster> {
  // @ts-expect-error untyped ESM bundle with the WASM inlined; loaded only when a HEIC arrives
  const mod = await import("libheif-js/libheif-wasm/libheif-bundle.mjs");
  const libheif = mod.default();
  const decoder = new libheif.HeifDecoder();
  const frames = decoder.decode(new Uint8Array(buf));
  if (!frames.length) throw new Error("heic_empty");
  const image = frames[0];
  const width = image.get_width();
  const height = image.get_height();
  const data = await new Promise<Uint8ClampedArray>((resolve, reject) => {
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (d: { data: Uint8ClampedArray } | null) =>
      d ? resolve(d.data) : reject(new Error("heic_decode")),
    );
  });
  for (const f of frames) f.free?.();
  return { data, width, height };
}

async function bitmapFromRaster(r: Raster, maxEdge: number): Promise<ImageBitmap> {
  const s = Math.min(1, maxEdge / Math.max(r.width, r.height));
  const src = new OffscreenCanvas(r.width, r.height);
  src.getContext("2d")!.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
  const out = new OffscreenCanvas(Math.max(1, Math.round(r.width * s)), Math.max(1, Math.round(r.height * s)));
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out.transferToImageBitmap();
}

async function decode(id: string, file: Blob, format: string) {
  let r: Raster;
  if (format === "heic") {
    r = await decodeHeic(await file.arrayBuffer());
  } else {
    // imageOrientation "from-image" applies EXIF rotation; drawing to a canvas drops all metadata.
    let bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (bmp.width * bmp.height > MAX_PIXELS) {
      const s = Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height));
      const w = Math.floor(bmp.width * s);
      const h = Math.floor(bmp.height * s);
      bmp.close();
      bmp = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    }
    r = await rasterFromBitmap(bmp);
    bmp.close();
  }
  images.set(id, r);
  const preview = await bitmapFromRaster(r, PREVIEW_EDGE);
  return Comlink.transfer({ width: r.width, height: r.height, preview }, [preview]);
}

// ---------- pixel ops ----------

function crop(r: Raster, c?: { x: number; y: number; w: number; h: number }): Raster {
  if (!c) return { data: r.data.slice(), width: r.width, height: r.height };
  const x = Math.max(0, Math.round(c.x));
  const y = Math.max(0, Math.round(c.y));
  const w = Math.max(1, Math.min(r.width - x, Math.round(c.w)));
  const h = Math.max(1, Math.min(r.height - y, Math.round(c.h)));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * r.width + x) * 4;
    out.set(r.data.subarray(s, s + w * 4), row * w * 4);
  }
  return { data: out, width: w, height: h };
}

function toGrey(px: Uint8ClampedArray) {
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = y;
  }
}

/** Otsu threshold of an already-grey buffer, nudged towards white so faint scanner grey doesn't speckle. */
function otsu(px: Uint8ClampedArray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
  const total = px.length / 4;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return Math.min(t + 10, 230);
}

function toBw(px: Uint8ClampedArray, t = otsu(px)) {
  for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = px[i] > t ? 255 : 0;
}

/** Pack a grey raster to 1 bit per pixel (1 = white) and Flate-compress it, as a PDF image stream. */
function packBits(r: Raster, t: number): Uint8Array {
  const rowBytes = (r.width + 7) >> 3;
  const out = new Uint8Array(rowBytes * r.height);
  for (let y = 0; y < r.height; y++) {
    const row = y * r.width * 4;
    for (let x = 0; x < r.width; x++) {
      if (r.data[row + x * 4] > t) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return zlibSync(out, { level: 9 });
}

async function resize(r: Raster, w: number, h: number): Promise<Raster> {
  if (w === r.width && h === r.height) return r;
  const out = await pica.resizeBuffer({ src: r.data, width: r.width, height: r.height, toWidth: w, toHeight: h, filter: "lanczos3" });
  return { data: new Uint8ClampedArray(out.buffer, out.byteOffset, out.byteLength), width: w, height: h };
}

async function jpeg(r: Raster, q: number, grey: boolean, dpi?: number) {
  const buf = await encodeJpeg(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), {
    quality: q,
    color_space: grey ? 1 : 3,
    progressive: false, // baseline JPEG: some portal validators reject progressive files
    optimize_coding: true,
  });
  let bytes = new Uint8Array(buf);
  if (dpi) bytes = setJpegDpi(bytes, dpi) as Uint8Array<ArrayBuffer>;
  return { bytes, size: bytes.length };
}

// ---------- image job ----------

export type ImageJob = {
  crop?: { x: number; y: number; w: number; h: number };
  colour: Colour;
  pixels?: { w: number; h: number };
  maxLongEdge?: number;
  maxBytes: number;
  minBytes?: number;
  dpi?: number;
};

export type ImageResult = {
  bytes: Uint8Array;
  width: number;
  height: number;
  quality: number;
  fit: boolean;
  belowMin: boolean;
  shrunk: boolean;
};

const Q_HI = 92;

async function processImage(id: string, job: ImageJob): Promise<ImageResult> {
  const src = images.get(id);
  if (!src) throw new Error("gone");
  const base = crop(src, job.crop);
  const grey = job.colour !== "colour";
  if (grey) toGrey(base.data);

  let w: number, h: number;
  if (job.pixels) {
    ({ w, h } = job.pixels);
  } else {
    const s = job.maxLongEdge ? Math.min(1, job.maxLongEdge / Math.max(base.width, base.height)) : 1;
    w = Math.max(1, Math.round(base.width * s));
    h = Math.max(1, Math.round(base.height * s));
  }
  const floor = job.pixels ? 5 : 40;
  let shrunk = false;

  for (let step = 0; step < 25; step++) {
    const resized = await resize(base, w, h);
    // Threshold after resizing so edges stay crisp; never mutate `base`, later steps reuse it.
    const r = job.colour === "bw" && resized === base ? { ...base, data: base.data.slice() } : resized;
    if (job.colour === "bw") toBw(r.data);
    const found = await searchQuality((q) => jpeg(r, q, grey, job.dpi), floor, Q_HI, job.maxBytes);
    if (found.q !== null) {
      let out = found.out;
      let quality = found.q;
      let belowMin = false;
      if (job.minBytes && out.size < job.minBytes) {
        // Raise quality first; never pad the file.
        const max = await jpeg(r, 100, grey, job.dpi);
        if (max.size <= job.maxBytes && max.size > out.size) { out = max; quality = 100; }
        belowMin = out.size < job.minBytes;
      }
      return Comlink.transfer({ bytes: out.bytes, width: w, height: h, quality, fit: true, belowMin, shrunk }, [out.bytes.buffer]);
    }
    if (job.pixels || Math.max(w, h) < 64) {
      const s = found.smallest;
      return Comlink.transfer({ bytes: s.bytes, width: w, height: h, quality: floor, fit: false, belowMin: false, shrunk }, [s.bytes.buffer]);
    }
    w = Math.max(1, Math.round(w * 0.9));
    h = Math.max(1, Math.round(h * 0.9));
    shrunk = true;
  }
  throw new Error("no_fit");
}

// ---------- PDF page encode (re-render and image→PDF paths) ----------

export type PageJob = {
  colour: Colour;
  budget: number;
  fallbackBudget?: number;
  dpi: number;
  /** The previous page's answer; consecutive pages of a scan are alike. */
  hint?: { q?: number; scale?: number };
};
export type PageResult = {
  bytes: Uint8Array;
  format: "jpeg" | "bits";
  width: number;
  height: number;
  quality?: number;
  scale: number;
  fit: boolean;
  dpi: number;
};

const SCALES = [1, 0.9, 0.81, 0.73, 0.66, 0.59];

async function encodePage(data: Uint8ClampedArray, width: number, height: number, job: PageJob): Promise<PageResult> {
  const base: Raster = { data, width, height };
  const grey = job.colour !== "colour";
  if (grey) toGrey(base.data);
  const bw = job.colour === "bw";
  const t = bw ? otsu(base.data) : 0;
  const startAt = bw ? 0 : Math.max(0, SCALES.indexOf(job.hint?.scale ?? 1));

  const tryBudget = async (budget: number): Promise<PageResult | null> => {
    // Quality first (JPEG), then down to 60% of the render DPI in 10% steps.
    for (let i = startAt; i < SCALES.length; i++) {
      const s = SCALES[i];
      const w = Math.max(1, Math.round(width * s));
      const h = Math.max(1, Math.round(height * s));
      const r = await resize(base, w, h);
      const dpi = Math.round(job.dpi * s);
      if (bw) {
        // Black and white goes in as a 1-bit Flate image: far smaller and crisper than a JPEG of the same page.
        const bytes = packBits(r, t);
        if (bytes.length + 300 <= budget) return { bytes, format: "bits", width: w, height: h, scale: s, fit: true, dpi };
        continue;
      }
      const found = await searchQuality((q) => jpeg(r, q, grey), 25, 85, budget, { hint: job.hint?.q, tolerance: 3 });
      if (found.q !== null) return { bytes: found.out.bytes, format: "jpeg", width: w, height: h, quality: found.q, scale: s, fit: true, dpi };
    }
    return null;
  };

  let res = await tryBudget(job.budget);
  if (!res && job.fallbackBudget && job.fallbackBudget > job.budget) res = await tryBudget(job.fallbackBudget);
  if (!res) {
    const s = SCALES[SCALES.length - 1];
    const w = Math.round(width * s), h = Math.round(height * s);
    const r = await resize(base, w, h);
    const bytes = bw ? packBits(r, t) : (await jpeg(r, 25, grey)).bytes;
    res = { bytes, format: bw ? "bits" : "jpeg", width: w, height: h, quality: bw ? undefined : 25, scale: s, fit: false, dpi: Math.round(job.dpi * s) };
  }
  return Comlink.transfer(res, [res.bytes.buffer]);
}

/** A decoded image (by id), cropped and capped to a long edge, encoded as one PDF page. */
async function encodeStoredPage(id: string, cropRect: ImageJob["crop"], maxLongEdge: number, job: PageJob): Promise<PageResult> {
  const src = images.get(id);
  if (!src) throw new Error("gone");
  const c = crop(src, cropRect);
  const s = Math.min(1, maxLongEdge / Math.max(c.width, c.height));
  const r = await resize(c, Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s)));
  const data = r === c ? c.data : r.data;
  return encodePage(data, r.width, r.height, job);
}

// ---------- PDF ----------

async function pdfInfo(bytes: Uint8Array): Promise<{ pages: number | null; encrypted: boolean }> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { pages: doc.getPageCount(), encrypted: doc.isEncrypted };
  } catch {
    return { pages: null, encrypted: false };
  }
}

export type PdfPage = { bytes: Uint8Array; format: "jpeg" | "bits"; width: number; height: number; widthPt: number; heightPt: number };

async function assemblePdf(pages: PdfPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer("Dabaao");
  doc.setCreator("Dabaao");
  for (const p of pages) {
    const page = doc.addPage([p.widthPt, p.heightPt]);
    if (p.format === "jpeg") {
      const img = await doc.embedJpg(p.bytes);
      page.drawImage(img, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
      continue;
    }
    const dict = doc.context.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: p.width,
      Height: p.height,
      ColorSpace: "DeviceGray",
      BitsPerComponent: 1,
      Filter: "FlateDecode",
    });
    const ref = doc.context.register(PDFRawStream.of(dict, p.bytes));
    const name = page.node.newXObject("Im", ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(p.widthPt, 0, 0, p.heightPt, 0, 0),
      drawObject(name),
      popGraphicsState(),
    );
  }
  const out = await doc.save({ useObjectStreams: true });
  return Comlink.transfer(out, [out.buffer]);
}

let qpdfWasm: Promise<ArrayBuffer> | null = null;

/** Lossless optimisation with qpdf. Returns null if qpdf can't read the file (e.g. needs a password). */
async function qpdfOptimize(bytes: Uint8Array, decrypt: boolean): Promise<Uint8Array | null> {
  qpdfWasm ??= fetch(qpdfWasmUrl).then((r) => r.arrayBuffer());
  const wasmBinary = await qpdfWasm;
  const { default: createQpdf } = await import("@neslinesli93/qpdf-wasm");
  const stderr: string[] = [];
  // A fresh instance per run: Emscripten mains aren't guaranteed re-entrant.
  const qpdf = await (createQpdf as unknown as (o: object) => Promise<any>)({
    noInitialRun: true,
    print: () => {},
    printErr: (line: string) => stderr.push(line),
    wasmBinary,
    locateFile: () => qpdfWasmUrl,
  });
  qpdf.FS.writeFile("/in.pdf", bytes);
  const args = [
    "--object-streams=generate",
    "--compress-streams=y",
    "--recompress-flate",
    "--compression-level=9",
    "--remove-unreferenced-resources=yes",
    ...(decrypt ? ["--decrypt"] : []),
    "/in.pdf",
    "/out.pdf",
  ];
  let code: number;
  try {
    code = qpdf.callMain(args);
  } catch (e: any) {
    code = typeof e?.status === "number" ? e.status : 2;
    if (code === 2) stderr.push(String(e?.message ?? e));
  }
  // qpdf exit codes: 0 ok, 3 ok with warnings, 2 error.
  if (code !== 0 && code !== 3) {
    console.warn("[qpdf] exit", code, stderr.slice(0, 5).join(" | "));
    return null;
  }
  try {
    const out: Uint8Array = qpdf.FS.readFile("/out.pdf");
    const copy = out.slice();
    return Comlink.transfer(copy, [copy.buffer]);
  } catch {
    return null;
  }
}

/** Copy a page range out of a PDF (used to split lossless output). */
async function extractPages(bytes: Uint8Array, start: number, end: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer("Dabaao");
  const pages = await doc.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i));
  for (const p of pages) doc.addPage(p);
  const out = await doc.save({ useObjectStreams: true });
  return Comlink.transfer(out, [out.buffer]);
}

function zip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const out = zipSync(Object.fromEntries(entries.map((e) => [e.name, [e.data, { level: 0 }]])));
  return Comlink.transfer(out, [out.buffer]);
}

function release(id: string) {
  images.delete(id);
}

function clear() {
  images.clear();
}

const api = { decode, processImage, encodePage, encodeStoredPage, pdfInfo, assemblePdf, qpdfOptimize, extractPages, zip, release, clear };
export type EngineApi = typeof api;
Comlink.expose(api);
