// PDF.js parses in its own worker; pages are rasterised here and handed to our engine worker for encoding.
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { blobUrl } from "./urls";

const base = import.meta.env.BASE_URL;
let lib: Promise<typeof import("pdfjs-dist")> | null = null;

async function pdfjs() {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
  return lib;
}

export class PasswordError extends Error {}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  try {
    return await m.getDocument({
      data: bytes.slice(), // PDF.js transfers (detaches) the buffer it is given
      cMapUrl: `${base}pdfjs/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
      wasmUrl: `${base}pdfjs/wasm/`,
      iccUrl: `${base}pdfjs/iccs/`,
      enableXfa: false,
    }).promise;
  } catch (e: any) {
    if (e?.name === "PasswordException") throw new PasswordError("password");
    throw e;
  }
}

const MAX_SIDE = 5000;
const MAX_AREA = 25_000_000;

/** Render one page at the requested DPI (clamped for memory) to raw RGBA. */
export async function renderPage(doc: PDFDocumentProxy, index: number, dpi: number) {
  const page = await doc.getPage(index + 1);
  const unit = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  scale = Math.min(scale, MAX_SIDE / unit.width, MAX_SIDE / unit.height, Math.sqrt(MAX_AREA / (unit.width * unit.height)));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp, background: "#ffffff" }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  page.cleanup();
  canvas.width = canvas.height = 0; // release the backing store now, not at GC
  return { data: img.data, width: img.width, height: img.height, widthPt: unit.width, heightPt: unit.height, dpi: Math.round(scale * 72) };
}

/** First-page thumbnail as an object URL. */
export async function thumbnail(bytes: Uint8Array, width = 320): Promise<string | undefined> {
  try {
    const doc = await openPdf(bytes);
    const page = await doc.getPage(1);
    const unit = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / unit.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    await doc.loadingTask.destroy();
    return blob ? blobUrl(blob, "image/png") : undefined;
  } catch {
    return undefined;
  }
}
