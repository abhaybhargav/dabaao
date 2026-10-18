import data from "./presets.json";

export type InputFormat = "jpeg" | "png" | "webp" | "heic" | "pdf";
export type Colour = "colour" | "grey" | "bw";

export type Preset = {
  id: string;
  portal: string;
  slot: string;
  /** "match" keeps the input's kind: images stay JPEG, PDFs stay PDF. */
  output: "jpeg" | "pdf" | "match";
  accepts: InputFormat[];
  /** Whole-file cap. Absent when only a per-page cap applies. */
  maxBytes?: number;
  minBytes?: number;
  maxBytesPerPage?: number;
  /** Total across all files in one submission (Income Tax). */
  totalBytes?: number;
  maxFiles?: number;
  pixels?: { w: number; h: number };
  maxLongEdge?: number;
  dpi?: number;
  colour: Colour;
  /** Offer the B&W "ink" filter (signatures). */
  ink?: boolean;
  pdfA?: boolean;
  source: string;
  verified: string;
  confidence: "official" | "secondary";
  note?: string;
};

export const PRESETS_VERSION: string = data.version;
export const PRESETS = data.presets as Preset[];

export const CUSTOM_ID = "custom";

export function defaultCustom(): Preset {
  return {
    id: CUSTOM_ID,
    portal: "Custom",
    slot: "Custom",
    output: "match",
    accepts: ["jpeg", "png", "webp", "heic", "pdf"],
    maxBytes: 200000,
    dpi: 150,
    colour: "colour",
    ink: true,
    source: "",
    verified: "",
    confidence: "official",
  };
}

export function portals(): string[] {
  return [...new Set(PRESETS.map((p) => p.portal))];
}

/** The output kind for a given input under a preset. */
export function outputFor(preset: Preset, input: InputFormat): "jpeg" | "pdf" {
  if (preset.output !== "match") return preset.output;
  return input === "pdf" ? "pdf" : "jpeg";
}

/** Effective per-page budget for re-rendered PDFs. */
export function pageCap(preset: Preset): number | undefined {
  return preset.maxBytesPerPage;
}
