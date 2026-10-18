import type { Preset } from "../presets";
import { fmtBytes } from "./format";

export type OutputFacts = {
  kind: "jpeg" | "pdf";
  bytes: number;
  width?: number;
  height?: number;
  dpi?: number;
  pages?: number;
  /** Largest single page, for per-page caps (re-rendered PDFs only). */
  maxPageBytes?: number;
};

export type Problem =
  | { code: "too_big"; bytes: number; max: number }
  | { code: "too_small"; bytes: number; min: number }
  | { code: "wrong_kind"; want: string }
  | { code: "wrong_pixels"; want: string; got: string }
  | { code: "wrong_dpi"; want: number; got?: number }
  | { code: "page_too_big"; bytes: number; max: number }
  | { code: "page_cap_unknown"; max: number };

export type CheckResult = { pass: boolean; summary: string; problems: Problem[]; warnings: Problem[] };

/** The last gate before the Download button turns on. */
export function check(preset: Preset, kind: "jpeg" | "pdf", o: OutputFacts): CheckResult {
  const problems: Problem[] = [];
  const warnings: Problem[] = [];
  if (o.kind !== kind) problems.push({ code: "wrong_kind", want: kind.toUpperCase() });

  let cap = preset.maxBytes;
  if (cap === undefined && preset.maxBytesPerPage && (o.pages ?? 1) === 1) cap = preset.maxBytesPerPage;
  if (cap !== undefined && o.bytes > cap) problems.push({ code: "too_big", bytes: o.bytes, max: cap });
  if (preset.minBytes && o.bytes < preset.minBytes) problems.push({ code: "too_small", bytes: o.bytes, min: preset.minBytes });

  if (o.kind === "jpeg" && preset.pixels && (o.width !== preset.pixels.w || o.height !== preset.pixels.h)) {
    problems.push({ code: "wrong_pixels", want: `${preset.pixels.w} × ${preset.pixels.h}`, got: `${o.width} × ${o.height}` });
  }
  if (o.kind === "jpeg" && preset.dpi && o.dpi !== preset.dpi) problems.push({ code: "wrong_dpi", want: preset.dpi, got: o.dpi });

  if (o.kind === "pdf" && preset.maxBytesPerPage && (o.pages ?? 1) > 1) {
    if (o.maxPageBytes !== undefined) {
      if (o.maxPageBytes > preset.maxBytesPerPage) problems.push({ code: "page_too_big", bytes: o.maxPageBytes, max: preset.maxBytesPerPage });
    } else if (o.bytes / (o.pages ?? 1) > preset.maxBytesPerPage) {
      // Without per-page sizes (lossless output), the average is the best evidence we have.
      problems.push({ code: "page_too_big", bytes: Math.round(o.bytes / (o.pages ?? 1)), max: preset.maxBytesPerPage });
    } else {
      warnings.push({ code: "page_cap_unknown", max: preset.maxBytesPerPage });
    }
  }

  return { pass: problems.length === 0, summary: summarise(preset, o), problems, warnings };
}

export function summarise(preset: Preset, o: OutputFacts): string {
  const parts: string[] = [];
  const cap = preset.maxBytes ?? (o.pages === 1 || o.kind === "jpeg" ? preset.maxBytesPerPage : undefined);
  parts.push(cap ? `${fmtBytes(o.bytes)} / ${fmtBytes(cap)}` : fmtBytes(o.bytes));
  if (o.kind === "pdf" && o.pages) parts.push(`${o.pages} ${o.pages === 1 ? "page" : "pages"}`);
  if (o.kind === "jpeg" && o.width) parts.push(`${o.width} × ${o.height} px`);
  parts.push(o.kind.toUpperCase());
  if (o.dpi) parts.push(`${o.dpi} DPI`);
  return parts.join(", ");
}
