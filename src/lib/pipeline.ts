import * as Comlink from "comlink";
import { engine } from "./engine";
import { check, type CheckResult, type OutputFacts } from "./check";
import { readJpegInfo } from "./jfif";
import { splitPages } from "./split";
import { openPdf, renderPage, thumbnail, PasswordError } from "./pdfjs";
import { blobUrl } from "./urls";
import type { Preset } from "../presets";
import type { PdfPage } from "../worker/engine";

export type Method = "image" | "lossless" | "rerender";

/** A note shown on a result; `key` is an i18n key, `vars` fill its placeholders. */
export type Note = { key: string; vars?: Record<string, string | number> };

export type Part = {
  name: string;
  kind: "jpeg" | "pdf";
  bytes: Uint8Array;
  url: string;
  previewUrl?: string;
  facts: OutputFacts;
  check: CheckResult;
};

export type Variant = { method: Method; parts: Part[]; notes: Note[]; textSelectable: boolean };

export type Crop = { x: number; y: number; w: number; h: number };

const A4_LONG_IN = 11.69;

function jpegPart(preset: Preset, name: string, bytes: Uint8Array): Part {
  const info = readJpegInfo(bytes);
  const facts: OutputFacts = { kind: "jpeg", bytes: bytes.length, width: info?.width, height: info?.height, dpi: info?.dpi };
  return { name, kind: "jpeg", bytes, url: blobUrl(bytes as BlobPart, "image/jpeg"), previewUrl: undefined, facts, check: check(preset, "jpeg", facts) };
}

async function pdfPart(preset: Preset, name: string, bytes: Uint8Array, pages: number, extra: Partial<OutputFacts> = {}): Promise<Part> {
  const facts: OutputFacts = { kind: "pdf", bytes: bytes.length, pages, ...extra };
  const url = blobUrl(bytes as BlobPart, "application/pdf");
  return { name, kind: "pdf", bytes, url, previewUrl: await thumbnail(bytes), facts, check: check(preset, "pdf", facts) };
}

// ---------- images → JPEG ----------

export async function imageToJpeg(id: string, preset: Preset, base: string, opts: { crop?: Crop; colour: Preset["colour"] }): Promise<Variant> {
  const max = preset.maxBytes ?? preset.maxBytesPerPage;
  if (!max) throw new Error("no_cap");
  const r = await engine().processImage(id, {
    crop: opts.crop,
    colour: opts.colour,
    pixels: preset.pixels,
    maxLongEdge: preset.pixels ? undefined : preset.maxLongEdge,
    maxBytes: max,
    minBytes: preset.minBytes,
    dpi: preset.dpi,
  });
  const part = jpegPart(preset, `${base}.jpg`, r.bytes);
  part.previewUrl = part.url;
  const notes: Note[] = [];
  if (r.shrunk) notes.push({ key: "note.shrunk", vars: { w: r.width, h: r.height } });
  if (r.belowMin) notes.push({ key: "note.belowMin" });
  if (!r.fit) notes.push({ key: "note.cannotFit" });
  notes.push({ key: "note.quality", vars: { q: r.quality } });
  return { method: "image", parts: [part], notes, textSelectable: false };
}

// ---------- shared PDF assembly with automatic split ----------

type EncodedPage = PdfPage & { size: number; dpi: number; fit: boolean };

async function assembleParts(preset: Preset, base: string, pages: EncodedPage[]): Promise<{ parts: Part[]; split: boolean }> {
  const e = engine();
  const cap = preset.maxBytes;
  const ranges = cap ? splitPages(pages.map((p) => p.size), cap) : [[0, pages.length] as [number, number]];

  const built: { range: [number, number]; bytes: Uint8Array }[] = [];
  const queue = [...ranges];
  while (queue.length) {
    const [a, b] = queue.shift()!;
    const bytes = await e.assemblePdf(pages.slice(a, b).map(({ bytes, format, width, height, widthPt, heightPt }) => ({ bytes, format, width, height, widthPt, heightPt })));
    if (cap && bytes.length > cap && b - a > 1) {
      // The overhead estimate was off; halve and retry.
      const mid = a + Math.floor((b - a) / 2);
      queue.unshift([a, mid], [mid, b]);
      continue;
    }
    built.push({ range: [a, b], bytes });
  }
  built.sort((x, y) => x.range[0] - y.range[0]);
  const split = built.length > 1;
  const parts: Part[] = [];
  for (let i = 0; i < built.length; i++) {
    const { range: [a, b], bytes } = built[i];
    const slice = pages.slice(a, b);
    parts.push(
      await pdfPart(preset, split ? `${base}_${i + 1}.pdf` : `${base}.pdf`, bytes, b - a, {
        dpi: Math.min(...slice.map((p) => p.dpi)),
        maxPageBytes: Math.max(...slice.map((p) => p.size)),
      }),
    );
  }
  return { parts, split };
}

/** Per-page JPEG budget: the per-page cap, or an even share of the whole-file cap after container overhead. */
function budgets(preset: Preset, pages: number) {
  const per = preset.maxBytesPerPage ?? Infinity;
  const share = preset.maxBytes ? (preset.maxBytes * 0.98 - 1500 - 500 * pages) / pages : Infinity;
  let budget = Math.min(per, share);
  if (!Number.isFinite(budget)) budget = 500_000;
  const fallback = Math.min(per, preset.maxBytes ? preset.maxBytes * 0.95 - 2000 : Infinity);
  return { budget: Math.max(1000, budget), fallback: Number.isFinite(fallback) ? fallback : undefined };
}

// ---------- images → PDF ----------

export async function imagesToPdf(
  items: { id: string; crop?: Crop }[],
  preset: Preset,
  base: string,
  colour: Preset["colour"],
): Promise<Variant> {
  const e = engine();
  const dpi = preset.dpi ?? 150;
  const longEdge = Math.min(preset.maxLongEdge ?? Infinity, Math.round(A4_LONG_IN * dpi));
  const { budget, fallback } = budgets(preset, items.length);
  const pages: EncodedPage[] = [];
  let hint: { q?: number; scale?: number } | undefined;
  for (const it of items) {
    const r = await e.encodeStoredPage(it.id, it.crop, longEdge, { colour, budget, fallbackBudget: fallback, dpi, hint });
    hint = { q: r.quality, scale: r.scale };
    // Page size comes from the unscaled pixels, so a lower-DPI fallback keeps the paper size.
    pages.push({ ...r, widthPt: (r.width / r.scale) * 72 / dpi, heightPt: (r.height / r.scale) * 72 / dpi, size: r.bytes.length });
  }
  const { parts, split } = await assembleParts(preset, base, pages);
  const notes: Note[] = [{ key: "note.wrapped", vars: { n: items.length } }];
  if (split) notes.push({ key: "note.split", vars: { n: parts.length } });
  if (pages.some((p) => !p.fit)) notes.push({ key: "note.cannotFit" });
  if (preset.pdfA) notes.push({ key: "note.noPdfA" });
  return { method: "image", parts, notes, textSelectable: false };
}

// ---------- PDF → PDF ----------

export class PdfError extends Error {
  constructor(public code: "password" | "unreadable") {
    super(code);
  }
}

export async function pdfLossless(bytes: Uint8Array, preset: Preset, base: string): Promise<Variant> {
  const e = engine();
  const info = await e.pdfInfo(bytes);
  let pages = info.pages;
  const out = await e.qpdfOptimize(bytes, info.encrypted);
  if (!out) {
    if (info.encrypted) throw new PdfError("password");
    throw new PdfError("unreadable");
  }
  // Keep the original when qpdf can't beat it (and it isn't encrypted).
  const best = !info.encrypted && bytes.length <= out.length ? bytes : out;
  if (pages === null) {
    const doc = await openPdf(best);
    pages = doc.numPages;
    await doc.loadingTask.destroy();
  }
  const part = await pdfPart(preset, `${base}.pdf`, best, pages);
  const notes: Note[] = [{ key: best === bytes ? "note.alreadyOptimal" : "note.lossless", vars: { from: bytes.length, to: best.length } }];
  if (info.encrypted) notes.push({ key: "note.decrypted" });
  if (preset.pdfA) notes.push({ key: "note.noPdfA" });
  return { method: "lossless", parts: [part], notes, textSelectable: true };
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  try {
    const doc = await openPdf(bytes);
    const n = doc.numPages;
    await doc.loadingTask.destroy();
    return n;
  } catch (err) {
    if (err instanceof PasswordError) throw new PdfError("password");
    throw new PdfError("unreadable");
  }
}

export async function pdfRerender(
  bytes: Uint8Array,
  preset: Preset,
  base: string,
  colour: Preset["colour"],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Variant> {
  const e = engine();
  let doc;
  try {
    doc = await openPdf(bytes);
  } catch (err) {
    if (err instanceof PasswordError) throw new PdfError("password");
    throw new PdfError("unreadable");
  }
  const n = doc.numPages;
  const dpi = preset.dpi ?? 150;
  const { budget, fallback } = budgets(preset, n);
  const pages: EncodedPage[] = [];
  let hint: { q?: number; scale?: number } | undefined;
  try {
    // One page at a time keeps memory flat on long scans.
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      onProgress(i, n);
      const r = await renderPage(doc, i, dpi);
      const out = await e.encodePage(Comlink.transfer(r.data, [r.data.buffer]), r.width, r.height, { colour, budget, fallbackBudget: fallback, dpi: r.dpi, hint });
      hint = { q: out.quality, scale: out.scale };
      pages.push({ ...out, widthPt: r.widthPt, heightPt: r.heightPt, size: out.bytes.length });
    }
    onProgress(n, n);
  } finally {
    await doc.loadingTask.destroy();
  }
  const { parts, split } = await assembleParts(preset, base, pages);
  const notes: Note[] = [{ key: "note.rerendered", vars: { dpi: Math.min(...pages.map((p) => p.dpi)) } }];
  if (split) notes.push({ key: "note.split", vars: { n: parts.length } });
  if (pages.some((p) => !p.fit)) notes.push({ key: "note.cannotFit" });
  if (preset.pdfA) notes.push({ key: "note.noPdfA" });
  return { method: "rerender", parts, notes, textSelectable: false };
}

export function variantPasses(v: Variant): boolean {
  return v.parts.every((p) => p.check.pass);
}
