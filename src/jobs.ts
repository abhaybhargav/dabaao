import type { InputFormat } from "./presets";
import type { Crop, Note, Variant } from "./lib/pipeline";

export type Job = {
  id: string;
  file?: File;
  name: string;
  base: string;
  size: number;
  format: InputFormat | null;
  status: "queued" | "decoding" | "working" | "done" | "error";
  phase?: "optimising" | "rendering";
  progress?: { done: number; total: number };
  error?: string;
  dims?: { w: number; h: number };
  bitmap?: ImageBitmap;
  decoded?: boolean;
  pages?: number;
  crop?: Crop;
  cropping?: boolean;
  ink: boolean;
  forceRerender?: boolean;
  variants: Variant[];
  chosen: number;
  warnings: Note[];
};

let seq = 0;
export const newId = () => `j${Date.now().toString(36)}${(seq++).toString(36)}`;
