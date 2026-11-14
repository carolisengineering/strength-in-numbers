import { fileURLToPath } from "node:url";
import { BURST_STEPS, GYM_STEPS } from "../plan/constants.ts";
import { lifterEnv } from "../plan/lifters.ts";
import { report, stepResults, type Report, type StepResult } from "../plan/report.ts";
import { seededRoutineSets } from "../plan/routine.ts";
import { burstSchedule, estimateRequests, gymSchedule, meanSessionS, type Schedule } from "../plan/schedule.ts";
import { resolveTarget } from "../plan/targets.ts";
import { accountIds } from "./accounts.ts";
import type { Api } from "./api.ts";
import type { RunCommand } from "./args.ts";
import { ensureSeeded } from "./seed.ts";

/**
 * Spec 16 — one run, in order: estimate (stop here on --dry-run) → tokens → seed each account → k6 → in `finally`,
 * cleanup (AC16) → read k6's summary → per-step results → the sentence → the result file. Side effects come in
 * through `deps`, so every path is testable without k6 or a network.
 */
export interface K6Child {
  exited: Promise<{ code: number | null; signal: string | null }>;
  kill(signal: "SIGINT"): void;
}

export interface RunDeps {
  spawnK6(args: string[], env: Record<string, string>): K6Child;
  tokens(ids: string[], expiresInS: number): Promise<string[]>;
  apisFor(tokens: string[]): Api[];
  cleanupAll(apis: Api[]): Promise<{ removed: number }>;
  writeResult(name: string, body: Record<string, unknown>): void;
  readSummary(path: string): unknown | undefined;
  /** The newest gym result for a target, if any (D9). */
  latestGymResult(target: string): GymResult | undefined;
  commit(baseUrl: string): Promise<string | null>;
  /** Registers a Ctrl-C handler; returns its removal. */
  onSigint(handler: () => void): () => void;
  now(): Date;
  log(line: string): void;
}

/** What the push gate reads from a gym result file. Files written before minor 366 have no `flags`. */
export interface GymResult {
  n: number | null;
  status?: string;
  flags?: { steps: number[] | null; holdScale: number | null };
}

/**
 * D9 / minor 366 — a push run may follow only a gym run that finished, wasn't shortened with the local-only
 * `--steps` / `--hold-scale`, and passed at least one step. Returns why not, or `null` when it may.
 */
export function gymGate(result: GymResult | undefined): string | null {
  if (!result) return "there is no gym run";
  if (result.status !== "complete") return "the newest gym run is incomplete";
  if (!result.flags) return "the newest gym run doesn't record how it was run";
  if (result.flags.steps !== null || result.flags.holdScale !== null) {
    return "the newest gym run was shortened with --steps / --hold-scale";
  }
  if (result.n === null) return "the newest gym run has no passing step";
  return null;
}

const K6_SCRIPT = fileURLToPath(new URL("../../k6/run.ts", import.meta.url));
const LOCAL_PROMETHEUS_RW = "http://localhost:9090/api/v1/write";
/** Tokens must outlive the run (Review Focus 2): the estimate plus half an hour. */
const TOKEN_MARGIN_S = 1800;

function scheduleFor(cmd: RunCommand, sets: number[]): Schedule {
  const steps = cmd.steps ?? (cmd.lifters !== undefined ? [cmd.lifters] : cmd.type === "burst" ? [...BURST_STEPS] : [...GYM_STEPS]);
  const s = cmd.type === "burst" ? burstSchedule(steps) : gymSchedule(steps, sets, cmd.push);
  if (cmd.holdScale === undefined) return s;
  const scale = cmd.holdScale;
  return { ...s, stages: s.stages.map((st) => ({ ...st, holdS: Math.max(10, Math.round(st.holdS * scale)) })) };
}

const durationS = (s: Schedule) => s.warmupS + s.stages.reduce((t, st) => t + st.rampS + st.holdS, 0);

function table(steps: StepResult[]): string[] {
  return [
    "step  lifters  set-save p95  5xx rate  429s  result",
    ...steps.map((s) =>
      [
        String(s.step).padEnd(4),
        String(s.lifters).padStart(7),
        (s.p95Ms === null ? "—" : `${Math.round(s.p95Ms)} ms`).padStart(12),
        (s.errorRate === null ? "—" : `${(s.errorRate * 100).toFixed(2)}%`).padStart(8),
        String(s.rateLimited).padStart(4),
        s.pass ? "pass" : `fail: ${s.failedOn}`,
      ].join("  "),
    ),
  ];
}

export async function runLoad(cmd: RunCommand, deps: RunDeps): Promise<number> {
  const target = resolveTarget(cmd.target);
  const sets = seededRoutineSets();
  const schedule = scheduleFor(cmd, sets);
  const accounts = Math.max(cmd.lifters ?? 0, ...schedule.stages.map((st) => st.lifters));

  const estimate = estimateRequests(schedule, sets, cmd.type);
  deps.log(`estimated requests: ${estimate}`);
  deps.log(`estimated duration: ${Math.ceil(durationS(schedule) / 60)} min, ${accounts} accounts, steps ${schedule.stages.map((s) => s.lifters).join(", ")}`);
  if (cmd.dryRun) return 0;

  if (cmd.type === "push" && !cmd.allowUnpassedPush) {
    const reason = gymGate(deps.latestGymResult(target.name));
    if (reason) {
      deps.log(`push needs a passing gym run on ${target.name} first: ${reason} (or --allow-unpassed-push)`);
      return 2;
    }
  }

  const baseUrl = target.baseUrl!;
  const ids = accountIds(accounts);
  const tokens = await deps.tokens(ids, durationS(schedule) + meanSessionS(sets, cmd.push) + TOKEN_MARGIN_S);
  const apis = deps.apisFor(tokens);
  const seeded: { routineId: string; sets: number[] }[] = [];
  for (const api of apis) seeded.push(await ensureSeeded(api));

  const start = deps.now();
  const stamp = start.toISOString().replace(/[:.]/g, "-");
  const summaryPath = `.summary-${stamp}.json`;
  const env: Record<string, string> = {
    ...lifterEnv(tokens.map((token, i) => ({ token, routineId: seeded[i]!.routineId }))),
    LOADTEST_TARGET: target.name,
    LOADTEST_BASE_URL: baseUrl,
    LOADTEST_TYPE: cmd.type,
    LOADTEST_PUSH: String(cmd.push),
    LOADTEST_SCHEDULE: JSON.stringify(schedule),
    LOADTEST_SUMMARY_PATH: summaryPath,
  };
  const args = ["run", "--quiet"];
  if (cmd.metricsOutput) {
    args.push("-o", "experimental-prometheus-rw");
    env.K6_PROMETHEUS_RW_SERVER_URL = LOCAL_PROMETHEUS_RW;
    env.K6_PROMETHEUS_RW_TREND_STATS = "p(95),max";
  }
  args.push(K6_SCRIPT);

  let summary: unknown;
  let cleanup: "done" | "failed" = "done";
  try {
    const child = deps.spawnK6(args, env);
    const release = deps.onSigint(() => child.kill("SIGINT"));
    try {
      const exit = await child.exited;
      deps.log(`k6 exited (code ${exit.code ?? "none"}${exit.signal ? `, signal ${exit.signal}` : ""})`);
    } finally {
      release();
    }
  } finally {
    deps.log("cleaning up the load-test accounts…");
    try {
      const { removed } = await deps.cleanupAll(apis);
      deps.log(`cleanup removed ${removed} workouts`);
    } catch (err) {
      // Never lose the run's result to a cleanup problem; say how to finish it by hand.
      cleanup = "failed";
      deps.log(`cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      deps.log(`finish it with: pnpm --filter @sin/loadtest run loadtest cleanup --target ${target.name} --lifters ${accounts}`);
    }
    summary = deps.readSummary(summaryPath);
  }

  const steps = stepResults(summary, schedule.stages.map((s) => s.lifters), cmd.type);
  const r: Report = report({ target: target.name, type: cmd.type, pushFactor: cmd.push, steps });
  // Complete only when every step was measured: a run stopped part-way keeps an honest N but is marked incomplete.
  const complete = summary !== undefined && steps.length > 0 && steps.every((s) => s.measured);
  deps.writeResult(`${stamp}-${target.name}-${cmd.type}.json`, {
    target: target.name,
    commit: await deps.commit(baseUrl),
    type: cmd.type,
    pushFactor: cmd.push,
    steps,
    n: r.n,
    x: r.x,
    nonMonotonic: r.nonMonotonic,
    window: { start: start.toISOString(), end: deps.now().toISOString() },
    status: complete ? "complete" : "incomplete",
    cleanup,
    // The push gate (D9) refuses a shortened gym run, so the result records how this one was run.
    flags: { steps: cmd.steps ?? null, holdScale: cmd.holdScale ?? null },
  });
  for (const line of table(steps)) deps.log(line);
  deps.log(r.sentence);
  return complete && cleanup === "done" ? 0 : 1;
}
