import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

import { commitMeta } from "./src/build/commitMeta";

// Auth0's refresh-token web worker, self-hosted so the production CSP can keep
// `script-src 'self'` with no `blob:` / `worker-src` relaxation (Spec 04.0
// §6.3 / §6.6 / AC8). The SDK ships this file; we copy it to the dist root and
// the Auth0 provider is pointed at `/auth0-spa-js.worker.production.js`.
const auth0Worker = fileURLToPath(
  import.meta.resolve(
    "@auth0/auth0-spa-js/dist/auth0-spa-js.worker.production.js",
  ),
);

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [{ src: auth0Worker, dest: "." }],
    }),
    // Spec 06.3 §6.3 — the e2e job waits until the deployed stamp is the pushed SHA.
    // Spec 15 AC19: production builds pass SIN_COMMIT; Render sets RENDER_GIT_COMMIT.
    commitMeta(process.env.SIN_COMMIT || process.env.RENDER_GIT_COMMIT),
  ],
  build: {
    // Emit no inline module-preload polyfill script, so `index.html` carries no
    // inline <script> and the CSP needs no hash or `unsafe-inline` (§6.6, AC1).
    modulePreload: { polyfill: false },
    // The single app chunk (React + Router + Auth0 SDK + TanStack Query + core)
    // is ~640 kB minified. That is expected for an SPA shell and stays one
    // hashed same-origin module script (CSP-clean); lift the advisory so CI
    // logs stay clean. Revisit with route-level code-splitting in a later spec.
    chunkSizeWarningLimit: 900,
    // Never inline a font as a data: URL: the CSP's font-src is 'self' only (Spec 17.0 §6.4, AC11).
    assetsInlineLimit: (filePath: string) => (filePath.endsWith(".woff2") ? false : undefined),
  },
});
