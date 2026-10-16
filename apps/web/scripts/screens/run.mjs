// `pnpm --filter @sin/web run screens` (Spec 17.0 §6.10, AC18): start the harness Vite server (fake Auth0,
// fake API), capture every screen in light and dark at 390 px and 1280 px into apps/web/.screens/, stop the
// server. A dev tool for design review; not run in CI.
//
//   SCREENS_THEMES=light       only one theme       SCREENS_DEVICES=mobile   only one viewport
//   SCREENS_KEEP_SERVER=1      leave the server up  SCREENS_PORT=5287        the port (default 5287)
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../..");
const require = createRequire(path.join(webRoot, "package.json"));
const PORT = Number(process.env.SCREENS_PORT ?? 5287);
const BASE = `http://localhost:${PORT}`;

// Placeholder config, not secrets: the fake Auth0 module ignores the tenant, and the API base URL is the
// harness server itself so Playwright can intercept /v1/*.
const HARNESS_ENV = {
  VITE_AUTH0_DOMAIN: "harness.example.auth0.com",
  VITE_AUTH0_CLIENT_ID: "harness-client-id",
  VITE_AUTH0_AUDIENCE: "https://api.strengthinnumbers.app",
  VITE_API_BASE_URL: BASE,
  VITE_APP_ENV: "local",
};

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "localhost" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function waitForServer(child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`vite exited with code ${child.exitCode}`);
    try {
      const res = await fetch(BASE + "/");
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("vite did not start within 60 s");
}

if (await portInUse(PORT)) {
  console.error(`port ${PORT} is already in use; stop that process or set SCREENS_PORT`);
  process.exit(1);
}

const install = spawnSync(process.execPath, [require.resolve("@playwright/test/cli"), "install", "chromium"], { cwd: webRoot, stdio: "ignore" });
if (install.status !== 0) {
  console.error("could not install Playwright's Chromium");
  process.exit(1);
}

const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--config", path.join(here, "vite.config.mjs")], {
  cwd: webRoot,
  env: { ...process.env, ...HARNESS_ENV, SCREENS_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let viteLog = "";
vite.stdout.on("data", (d) => { viteLog += d; });
vite.stderr.on("data", (d) => { viteLog += d; });

const stop = () => { if (process.env.SCREENS_KEEP_SERVER !== "1" && vite.exitCode === null) vite.kill(); };
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(130); });

let status = 0;
try {
  await waitForServer(vite);
  const capture = spawnSync(process.execPath, [path.join(here, "capture.mjs"), BASE], { cwd: webRoot, stdio: "inherit", env: process.env });
  status = capture.status ?? 1;
  console.log(`\nscreenshots: ${path.join(webRoot, ".screens")}`);
} catch (error) {
  console.error(String(error));
  console.error(viteLog);
  status = 1;
}
if (process.env.SCREENS_KEEP_SERVER === "1") {
  console.log(`server left running at ${BASE} (pid ${vite.pid}); stop it with Ctrl-C`);
  vite.stdout.pipe(process.stdout);
  vite.stderr.pipe(process.stderr);
} else {
  // Stop the server explicitly: its open stdio pipes would otherwise keep this process alive.
  stop();
  process.exit(status);
}
