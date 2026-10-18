import { describe, expect, it } from "vitest";
import { readJpegInfo, setJpegDpi } from "../src/lib/jfif";
import { searchQuality } from "../src/lib/search";
import { splitPages } from "../src/lib/split";
import { check } from "../src/lib/check";
import { sniff } from "../src/lib/sniff";
import { PRESETS, outputFor } from "../src/presets";

// Minimal JPEG: SOI, APP0 JFIF (aspect units), SOF0 300x200, EOI.
const jfif = () =>
  new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x2c, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);

describe("JFIF density", () => {
  it("rewrites an existing APP0", () => {
    const out = setJpegDpi(jfif(), 200);
    expect(out.length).toBe(jfif().length);
    expect(readJpegInfo(out)).toEqual({ width: 300, height: 200, dpi: 200 });
  });
  it("inserts APP0 when missing", () => {
    const src = jfif();
    const noApp0 = new Uint8Array([...src.subarray(0, 2), ...src.subarray(20)]);
    expect(readJpegInfo(noApp0)?.dpi).toBeUndefined();
    const out = setJpegDpi(noApp0, 300);
    expect(readJpegInfo(out)).toEqual({ width: 300, height: 200, dpi: 300 });
  });
});

describe("quality search", () => {
  const enc = (q: number) => Promise.resolve({ size: q * 100, q });
  it("finds the largest quality under the cap", async () => {
    const r = await searchQuality(enc, 10, 92, 5050);
    expect(r.q).toBe(50);
  });
  it("returns hi straight away when it fits", async () => {
    expect((await searchQuality(enc, 10, 92, 1e9)).q).toBe(92);
  });
  it("reports failure below the floor", async () => {
    const r = await searchQuality(enc, 10, 92, 500);
    expect(r.q).toBeNull();
  });
  it("uses few encodes", async () => {
    let n = 0;
    await searchQuality((q) => (n++, enc(q)), 5, 92, 3333);
    expect(n).toBeLessThanOrEqual(9);
  });
});

describe("split", () => {
  it("groups pages under the cap", () => {
    const parts = splitPages([300, 300, 300, 300, 300], 1000, 0, 0);
    expect(parts).toEqual([[0, 3], [3, 5]]);
  });
  it("gives an oversized page its own part", () => {
    expect(splitPages([100, 5000, 100], 1000, 0, 0)).toEqual([[0, 1], [1, 2], [2, 3]]);
  });
  it("one part when everything fits", () => {
    expect(splitPages([1, 2, 3], 1e6)).toEqual([[0, 3]]);
  });
});

describe("final check", () => {
  const pan = PRESETS.find((p) => p.id === "pan.photo")!;
  const sarathi = PRESETS.find((p) => p.id === "sarathi.photo")!;
  const icegate = PRESETS.find((p) => p.id === "icegate.esanchit")!;
  it("passes a compliant PAN photo", () => {
    const r = check(pan, "jpeg", { kind: "jpeg", bytes: 18000, width: 197, height: 276, dpi: 200 });
    expect(r.pass).toBe(true);
    expect(r.summary).toBe("18 KB / 20 KB, 197 × 276 px, JPEG, 200 DPI");
  });
  it("fails on size, pixels and dpi", () => {
    const r = check(pan, "jpeg", { kind: "jpeg", bytes: 21000, width: 200, height: 276 });
    expect(r.problems.map((p) => p.code).sort()).toEqual(["too_big", "wrong_dpi", "wrong_pixels"]);
  });
  it("enforces Sarathi's minimum", () => {
    const r = check(sarathi, "jpeg", { kind: "jpeg", bytes: 9000, width: 420, height: 525 });
    expect(r.problems.map((p) => p.code)).toEqual(["too_small"]);
  });
  it("enforces ICEGATE per-page cap", () => {
    const ok = check(icegate, "pdf", { kind: "pdf", bytes: 812000, pages: 12, maxPageBytes: 70000, dpi: 200 });
    expect(ok.pass).toBe(true);
    expect(ok.summary).toBe("812 KB / 1 MB, 12 pages, PDF, 200 DPI");
    const bad = check(icegate, "pdf", { kind: "pdf", bytes: 812000, pages: 12, maxPageBytes: 90000 });
    expect(bad.problems[0].code).toBe("page_too_big");
  });
});

describe("presets", () => {
  it("are well formed", () => {
    const ids = new Set<string>();
    for (const p of PRESETS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.maxBytes ?? p.maxBytesPerPage).toBeGreaterThan(0);
      expect(p.source).toMatch(/^https:\/\//);
      expect(p.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (p.output === "jpeg") expect(p.accepts).not.toContain("pdf");
    }
  });
  it("match keeps the input kind", () => {
    const gst = PRESETS.find((p) => p.id === "gst.proof")!;
    expect(outputFor(gst, "pdf")).toBe("pdf");
    expect(outputFor(gst, "heic")).toBe("jpeg");
  });
});

describe("sniff", () => {
  const b = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  it("detects formats by magic bytes", () => {
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("png");
    expect(sniff(b("%PDF-1.7"))).toBe("pdf");
    expect(sniff(b("RIFF....WEBPVP8 "))).toBe("webp");
    expect(sniff(b("\0\0\0\x18ftypheic"))).toBe("heic");
    expect(sniff(b("hello"))).toBeNull();
  });
});
