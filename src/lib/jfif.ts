/**
 * Set the JFIF density (DPI) header on a JPEG. Encoders usually write units=0 (aspect only),
 * and some portals read this field. Inserts an APP0 segment if the file has none.
 */
export function setJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Not a JPEG");
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const isJfif =
    jpeg[2] === 0xff && jpeg[3] === 0xe0 && String.fromCharCode(...jpeg.subarray(6, 11)) === "JFIF\0";
  if (isJfif) {
    const out = jpeg.slice();
    out[13] = 1; // units: dots per inch
    out[14] = d >> 8;
    out[15] = d & 0xff;
    out[16] = d >> 8;
    out[17] = d & 0xff;
    return out;
  }
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    d >> 8, d & 0xff, d >> 8, d & 0xff, 0x00, 0x00,
  ]);
  const out = new Uint8Array(jpeg.length + app0.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}

/** Read width, height and JFIF DPI from a JPEG, for the final check. */
export function readJpegInfo(jpeg: Uint8Array): { width: number; height: number; dpi?: number } | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let dpi: number | undefined;
  let i = 2;
  while (i + 4 < jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1];
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (marker === 0xe0 && String.fromCharCode(...jpeg.subarray(i + 4, i + 9)) === "JFIF\0") {
      const units = jpeg[i + 11];
      const x = (jpeg[i + 12] << 8) | jpeg[i + 13];
      if (units === 1) dpi = x;
      else if (units === 2) dpi = Math.round(x * 2.54);
    }
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (jpeg[i + 5] << 8) | jpeg[i + 6];
      const width = (jpeg[i + 7] << 8) | jpeg[i + 8];
      return { width, height, dpi };
    }
    i += 2 + len;
  }
  return null;
}
