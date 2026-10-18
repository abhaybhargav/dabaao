import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // External registerSW.js keeps the CSP free of inline scripts.
      injectRegister: "script",
      registerType: "autoUpdate",
      manifest: {
        name: "dabaao! — squeeze files for sarkari portals",
        short_name: "Dabaao",
        description: "Resize photos and PDFs to Indian government portal limits, entirely on your device.",
        theme_color: "#ffb627",
        background_color: "#fff4e0",
        display: "standalone",
        icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // Only the app's own code and data are cached; user files never touch the cache.
        globPatterns: ["**/*.{js,css,html,svg,wasm,json,pfb,ttf,icc,woff2}"],
        globIgnores: ["**/pdfjs/cmaps/**"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/pdfjs/cmaps/"),
            handler: "CacheFirst",
            options: { cacheName: "pdfjs-cmaps" },
          },
        ],
      },
    }),
  ],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@jsquash/jpeg"] },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
});
