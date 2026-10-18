# Dabaao

Live: https://dabaao.abhaybhargav.workers.dev · Source: https://github.com/abhaybhargav/dabaao

Resize and compress photos and PDFs to Indian government portal upload limits (PAN, GST, ICEGATE, Sarathi, Income Tax, DGFT, Aadhaar, DigiLocker), entirely in the browser. Files never leave the device: there is no backend, no upload endpoint, no database and no analytics.

## How it works

- **React + Vite** UI; all heavy work runs in a Web Worker (`src/worker/engine.ts`) via Comlink.
- **Images:** decode (JPEG/PNG/WebP via `createImageBitmap`, HEIC via libheif-js, loaded on demand) → EXIF rotation applied, metadata dropped → crop to the preset's aspect (fixed-pixel presets) → greyscale/B&W → pica Lanczos resize → MozJPEG quality binary search for the largest file under the cap → JFIF DPI header.
- **PDFs:** qpdf (WASM) lossless pass first; if still over the cap (or forced), PDF.js renders each page at the preset DPI, one page at a time. Colour/grey pages are MozJPEG-encoded within `cap ÷ pages`; black-and-white pages are stored as 1-bit Flate images. pdf-lib rebuilds the PDF and splits it into `_1`, `_2`, … parts if needed. Both results are shown side by side.
- Every output is checked against the preset (`src/lib/check.ts`) before its Download button turns on.
- Presets live in `src/presets.json`, each with a source URL and verified date.

## Privacy controls

- `public/_headers` sets a strict CSP (`connect-src 'self'`, no third-party anything), COOP/COEP and `Referrer-Policy: no-referrer`.
- Fonts, WASM and PDF.js data are self-hosted. The service worker precaches only app code.
- `wrangler.jsonc` deploys static assets only (no Worker script) with observability off.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (vitest)
npm run build && npm run preview   # production build with the real CSP
npm run deploy   # build + wrangler deploy
```

## Still to do

- Replace the portal home-page `source` URLs in `src/presets.json` with deep links to each portal's guideline page.
- Hindi and Kannada strings in `src/i18n.ts` are machine-written and should be reviewed by native speakers.
- Not implemented: PDF/A output for ICEGATE (planned Phase 5, Ghostscript WASM, AGPL). The ICEGATE preset says so in the UI.

## Licences

App: MIT. Bundled: pica (MIT), @jsquash/jpeg (Apache-2.0), pdfjs-dist (Apache-2.0), pdf-lib (MIT), qpdf-wasm (Apache-2.0 / ISC), libheif-js (LGPL-3.0, loaded as a separate chunk), fflate (MIT), Comlink (Apache-2.0).
