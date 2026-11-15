/**
 * Spec 16 — `pnpm --filter @sin/loadtest run loadtest <run|cleanup|seed|setup-accounts> …`. Wires the real side
 * effects (k6 as a child process, tokens from dev-idp or Auth0 by target, the API, result files, Ctrl-C) into
 * `runLoad`. Tokens never leave memory except as the k6 child's `LOADTEST_LIFTER_<i>` environment variables, one per
 * lifter.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GYM_STEPS } from "./plan/constants.ts";
import { resolveTarget, type Target } from "./plan/targets.ts";
import { accountEmail, accountIds } from "./node/accounts.ts";
import { apiFor } from "./node/api.ts";
import { parseArgs } from "./node/args.ts";
import { cleanupAll } from "./node/cleanup.ts";
import { ENV_FILE, RUN_SECRETS, SETUP_SECRETS, loadSecrets } from "./node/env.ts";
import { politeApis } from "./node/polite.ts";
import { prodBaseUrl } from "./node/prod.ts";
import { runLoad, type GymResult, type RunDeps } from "./node/run.ts";
import { ensureSeeded } from "./node/seed.ts";
import { mgmtClient, setupAccounts } from "./node/setup-accounts.ts";
import { auth0Tokens } from "./node/tokens-auth0.ts";
import { localTokens } from "./node/tokens-local.ts";

const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));
const PROD_TFVARS = fileURLToPath(new URL("../../../infra/prod.tfvars", import.meta.url));
const readProdBaseUrl = () => prodBaseUrl(readFileSync(PROD_TFVARS, "utf8"));
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

/**
 * The target's token source (AC6): dev-idp for `local`, Auth0's password-realm grant for `staging` / `prod`. The env
 * file is read only when tokens are needed, so a `--dry-run` works without it.
 */
function tokensFor(target: Target): RunDeps["tokens"] {
  if (target.tokenSource === "dev-idp") return (ids, expiresInS) => localTokens(ids, { idpUrl: IDP_URL, expiresInS });
  return (ids, expiresInS) => {
    const secrets = loadSecrets(ENV_FILE, RUN_SECRETS);
    log(`fetching ${ids.length} Auth0 tokens, 2 a second`);
    return auth0Tokens(ids.map(accountEmail), secrets, { fetchFn: fetch, sleep: pause, now: Date.now }, { needS: expiresInS });
  };
}

function realDeps(target: Target): RunDeps {
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
    tokens: tokensFor(target),
    // Read lazily, so a prod dry run prints its guards before prod.tfvars is checked.
    apisFor: (tokens) => politeFor(target.baseUrl ?? readProdBaseUrl(), tokens),
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
      return JSON.parse(readFileSync(join(RESULTS_DIR, newest), "utf8")) as GymResult;
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
    prodBaseUrl: readProdBaseUrl,
  };
}

async function main(argv: string[]): Promise<number> {
  const cmd = parseArgs(argv);
  if (cmd.cmd === "setup-accounts") {
    const secrets = loadSecrets(ENV_FILE, SETUP_SECRETS);
    const client = mgmtClient(secrets, { fetchFn: fetch, sleep: pause, now: Date.now });
    await setupAccounts(cmd.count, client, secrets, { dryRun: cmd.dryRun, log });
    return 0;
  }
  const target = resolveTarget(cmd.target);
  mkdirSync(RESULTS_DIR, { recursive: true });
  if (cmd.cmd === "run") return runLoad(cmd, realDeps(target));

  const baseUrl = target.baseUrl ?? readProdBaseUrl();
  const ids = accountIds(cmd.lifters ?? Math.max(...GYM_STEPS));
  const tokens = await tokensFor(target)(ids, 3600);
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
