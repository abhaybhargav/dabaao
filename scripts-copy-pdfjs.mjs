// Copies PDF.js runtime data (cmaps, fonts, wasm decoders) into public/ so nothing loads from a CDN.
import { cpSync, mkdirSync } from "node:fs";
const src = "node_modules/pdfjs-dist";
mkdirSync("public/pdfjs", { recursive: true });
for (const d of ["cmaps", "standard_fonts", "wasm", "iccs"]) cpSync(`${src}/${d}`, `public/pdfjs/${d}`, { recursive: true });
