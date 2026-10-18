import type { InputFormat } from "../presets";

/** Identify a file by its magic bytes rather than its extension or MIME type. */
export function sniff(head: Uint8Array): InputFormat | null {
  const s = (o: number, n: number) => String.fromCharCode(...head.subarray(o, o + n));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head[0] === 0x89 && s(1, 3) === "PNG") return "png";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "webp";
  if (s(0, 5) === "%PDF-") return "pdf";
  if (s(4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(s(8, 4))) return "heic";
  // Some PDFs carry junk before the header; PDF readers accept it within the first 1 KB.
  if (s(0, Math.min(head.length, 1024)).includes("%PDF-")) return "pdf";
  return null;
}

export async function sniffFile(file: Blob): Promise<InputFormat | null> {
  return sniff(new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
}
