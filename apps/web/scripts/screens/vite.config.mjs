// Vite config for the screenshot harness (Spec 17.0 §6.10). Root is apps/web; the only differences from the
// app's own vite.config.ts are the fake Auth0 alias, serving @sin/core from source, and a fixed port. The
// app's config is not modified and does not know this file exists (AC19).
// The API base URL is this same origin, so Playwright's page.route intercepts /v1/* with no CORS.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(webRoot, "../..");

// Resolve the app's own React plugin from apps/web at runtime (a non-literal import, so Vite's config
// bundler leaves it alone and the plugin's own `vite/internal` import resolves normally).
const webRequire = createRequire(path.join(webRoot, "package.json"));
const { default: react } = await import(pathToFileURL(webRequire.resolve("@vitejs/plugin-react")).href);

export const PORT = Number(process.env.SCREENS_PORT ?? 5287);

export default {
  root: webRoot,
  // No .env is read: run.mjs passes placeholder VITE_* values through the environment.
  envDir: here,
  cacheDir: path.join(webRoot, ".screens", ".vite-cache"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@auth0\/auth0-react$/, replacement: path.join(here, "fake-auth0-react.js") },
      { find: /^@auth0\/auth0-spa-js$/, replacement: path.join(here, "fake-auth0-react.js") },
      // packages/core/dist is gitignored and only rebuilt by `pnpm run build`; serve the TypeScript source so
      // the harness always matches the code.
      { find: /^@sin\/core$/, replacement: path.join(repoRoot, "packages/core/src/index.ts") },
    ],
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: PORT,
    strictPort: true,
    host: "localhost",
    fs: { allow: [webRoot, repoRoot, here] },
  },
};
