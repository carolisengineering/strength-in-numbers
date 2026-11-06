/**
 * Spec 16 — `pnpm --filter @sin/loadtest run loadtest <run|cleanup|seed> …`. Wires the real side effects (k6 as a
 * child process, dev-idp tokens, the API, result files, Ctrl-C) into `runLoad`. Tokens never leave memory except as
 * the k6 child's `LOADTEST_LIFTERS` environment variable.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GYM_STEPS } from "./plan/constants.ts";
import { resolveTarget } from "./plan/targets.ts";
import { accountIds } from "./node/accounts.ts";
import { apiFor } from "./node/api.ts";
import { parseArgs } from "./node/args.ts";
import { cleanupAll } from "./node/cleanup.ts";
import { politeApis } from "./node/polite.ts";
import { runLoad, type RunDeps } from "./node/run.ts";
import { ensureSeeded } from "./node/seed.ts";
import { localTokens } from "./node/tokens-local.ts";

const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));
const IDP_URL = process.env.LOADTEST_IDP_URL ?? "http://localhost:9999";
/**
 * The CLI's own requests (seed and cleanup) share one spacing across every account: 200 ms apart is 300 a minute,
 * half the API's per-IP budget, and a 429 waits for Retry-After (final review).
 */
const POLITE = { minIntervalMs: 200, maxRetries: 5 };

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const politeFor = (baseUrl: string, tokens: string[]) =>
  politeApis(
    tokens.map((t) => apiFor(baseUrl, t)),
    { ...POLITE, sleep: pause, now: Date.now },
  );
const noPace = () => Promise.resolve();
const log = (line: string) => process.stdout.write(`${line}\n`);

function realDeps(baseUrl: string): RunDeps {
  return {
    spawnK6: (args, env) => {
      const child = spawn("k6", args, { cwd: RESULTS_DIR, env: { ...process.env, ...env }, stdio: "inherit" });
      return {
        exited: new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code, signal) => resolve({ code, signal }));
        }),
        kill: (signal) => void child.kill(signal),
      };
    },
    tokens: (ids, expiresInS) => localTokens(ids, { idpUrl: IDP_URL, expiresInS }),
    apisFor: (tokens) => politeFor(baseUrl, tokens),
    cleanupAll: (apis) => cleanupAll(apis, { pace: noPace }),
    writeResult: (name, body) => {
      writeFileSync(join(RESULTS_DIR, name), `${JSON.stringify(body, null, 2)}\n`);
      log(`result: tools/loadtest/results/${name}`);
    },
    readSummary: (path) => {
      const file = join(RESULTS_DIR, path);
      if (!existsSync(file)) return undefined;
      try {
        return JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return undefined;
      } finally {
        rmSync(file, { force: true });
      }
    },
    latestGymResult: (target) => {
      const newest = readdirSync(RESULTS_DIR)
        .filter((f) => f.endsWith(`-${target}-gym.json`))
        .sort()
        .at(-1);
      if (!newest) return undefined;
      return JSON.parse(readFileSync(join(RESULTS_DIR, newest), "utf8")) as { n: number | null };
    },
    commit: async (url) => {
      try {
        const res = await fetch(`${url}/healthz`);
        return ((await res.json()) as { commit?: string }).commit ?? null;
      } catch {
        return null;
      }
    },
    onSigint: (handler) => {
      process.on("SIGINT", handler);
      return () => void process.off("SIGINT", handler);
    },
    now: () => new Date(),
    log,
  };
}

async function main(argv: string[]): Promise<number> {
  const cmd = parseArgs(argv);
  const baseUrl = resolveTarget(cmd.target).baseUrl!;
  mkdirSync(RESULTS_DIR, { recursive: true });
  if (cmd.cmd === "run") return runLoad(cmd, realDeps(baseUrl));

  const ids = accountIds(cmd.lifters ?? Math.max(...GYM_STEPS));
  const tokens = await localTokens(ids, { idpUrl: IDP_URL, expiresInS: 3600 });
  const apis = politeFor(baseUrl, tokens);
  if (cmd.cmd === "cleanup") {
    const { removed } = await cleanupAll(apis, { pace: noPace });
    log(`cleanup removed ${removed} workouts from ${apis.length} accounts`);
    return 0;
  }
  for (const api of apis) await ensureSeeded(api);
  log(`seeded ${apis.length} accounts`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
