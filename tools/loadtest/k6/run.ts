/**
 * Spec 16 — the k6 entry script. Thin: it reads its inputs from environment variables the CLI sets, runs each
 * lifter's plan through the pure executor, tags every request, and writes k6's summary for the CLI to report.
 * Imports only k6 modules and relative `.ts` paths (k6 loads them itself; AC1).
 *
 * Inputs (LOADTEST_LIFTER_<i> hold tokens: in memory only, never logged):
 *   LOADTEST_LIFTER_COUNT, then LOADTEST_LIFTER_<i>  JSON { token, routineId }   lifter i+1 uses entry i (minor 367)
 *   LOADTEST_TARGET, LOADTEST_BASE_URL, LOADTEST_TYPE (gym | push | burst), LOADTEST_PUSH,
 *   LOADTEST_SCHEDULE JSON Schedule, LOADTEST_SUMMARY_PATH,
 *   LOADTEST_RUN_NONCE  this run's 32-bit nonce, mixed into each lifter's payload seed only (minor 365)
 * LOADTEST_LIFTER_COUNT (at least 1) and LOADTEST_RUN_NONCE are required: without them k6 stops at init (minor 580).
 * Each VU parses only its own LOADTEST_LIFTER_<i>, on its first iteration (minor 581); a bad one aborts the whole run,
 * naming the variable.
 */
import { sleep } from "k6";
import exec from "k6/execution";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";
import { BURST_WINDOW_S, WARMUP_MAX_S, WARMUP_REQUESTS } from "../src/plan/constants.ts";
import { newLifterState, runActions, type ExecutorIo } from "../src/plan/executor.ts";
import { createRng } from "../src/plan/rng.ts";
import { lifterOrAbort, lifterSeeds, readLifterCount, readNonce, type LifterInput } from "../src/plan/lifters.ts";
import { SEEDED_ITEMS, seededRoutineSets } from "../src/plan/routine.ts";
import { burstOffset, stepAt, toK6Scenario, type RunType, type Schedule } from "../src/plan/schedule.ts";
import { OPEN_APP_READS, buildSession, joinAt, joinedActions, type Action } from "../src/plan/session.ts";
import { buildThresholds, countsAsServerError } from "../src/plan/thresholds.ts";
import type { TagKey } from "../src/plan/tags.ts";

const LIFTER_COUNT = readLifterCount(__ENV);
/** This VU's lifter. k6 gives every VU its own module state, so each one parses only its own variable. */
let lifter: LifterInput | undefined;
/** Every account holds the same seeded routine, so every lifter plans the same sets. */
const SETS = seededRoutineSets();
const SCHEDULE = JSON.parse(__ENV.LOADTEST_SCHEDULE ?? '{"warmupS":0,"pushFactor":1,"stages":[]}') as Schedule;
const TYPE = (__ENV.LOADTEST_TYPE ?? "gym") as RunType;
const TARGET = __ENV.LOADTEST_TARGET ?? "local";
const BASE_URL = __ENV.LOADTEST_BASE_URL ?? "http://localhost:8080";
const PUSH = Number(__ENV.LOADTEST_PUSH ?? "1");
const SUMMARY_PATH = __ENV.LOADTEST_SUMMARY_PATH ?? "summary.json";
// Minor 580: both are required; k6 started without the CLI refuses at init, naming the variable.
const NONCE = readNonce(__ENV);

export const options = {
  scenarios: toK6Scenario(SCHEDULE, TYPE),
  thresholds: buildThresholds(SCHEDULE.stages.length, TYPE),
  // "count" lets the reporter tell a step with no set saves from one with p95 0 (k6 lists zero-sample submetrics).
  summaryTrendStats: ["avg", "p(95)", "max", "count"],
  setupTimeout: `${WARMUP_MAX_S + 60}s`,
  // Minor 592: every metric, `vus` included (it has no request tags), carries the target the dashboard filters by.
  tags: { target: TARGET },
  // Every request is tagged by its template (AC11); never let k6 add the raw URL as a tag value.
  systemTags: ["status", "method", "name", "group", "check", "error_code", "scenario"],
};

const serverErrors = new Rate("server_errors");
const rateLimited = new Counter("rate_limited");

function tagsNow(t0: number, name: string, phaseOverride?: "warmup"): Record<TagKey, string> {
  const { step, phase } = phaseOverride ? { step: "warmup", phase: phaseOverride } : stepAt(SCHEDULE, Date.now() - t0);
  return { name, step, phase, target: TARGET };
}

function makeIo(token: string, t0: number): ExecutorIo {
  let current = "";
  return {
    tag: (t) => {
      current = t.name ?? current;
    },
    sleep: (s) => sleep(s),
    request: (method, path, body) => {
      const tags = tagsNow(t0, current);
      const res = http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), {
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-request-id": `loadtest-${exec.vu.idInTest}-${exec.vu.iterationInInstance}-${Date.now()}`,
        },
        tags,
      });
      serverErrors.add(countsAsServerError(res.status), tags);
      rateLimited.add(res.status === 429 ? 1 : 0, tags);
      return { status: res.status, json: () => res.json() };
    },
  };
}

/** Wake the target (Render free sleeps), then a few warm-up requests outside every threshold (AC10). */
export function setup(): { t0: number } {
  const deadline = Date.now() + WARMUP_MAX_S * 1000;
  for (;;) {
    const res = http.get(`${BASE_URL}/healthz`, { tags: { name: "warmup_healthz", step: "warmup", phase: "warmup", target: TARGET } });
    if (res.status === 200) break;
    if (Date.now() > deadline) throw new Error(`target did not answer /healthz with 200 within ${WARMUP_MAX_S} s`);
    sleep(2);
  }
  for (let i = 0; i < WARMUP_REQUESTS; i += 1) {
    const tags = { name: "warmup_healthz", step: "warmup", phase: "warmup", target: TARGET };
    const res = http.get(`${BASE_URL}/healthz`, { tags });
    serverErrors.add(countsAsServerError(res.status), tags);
  }
  return { t0: Date.now() };
}

const weights = SEEDED_ITEMS.map((i) => i.weightKg);

export default function (data: { t0: number }): void {
  const index = exec.vu.idInTest - 1;
  lifter ??= lifterOrAbort(__ENV, index, LIFTER_COUNT, (reason) => exec.test.abort(reason));
  const io = makeIo(lifter.token, data.t0);
  const iteration = exec.vu.iterationInInstance;
  // `seed` shapes the plan (reproducible, AC2); `payload` makes the bodies, fresh each run (minor 365).
  const { plan: seed, payload } = lifterSeeds(index, iteration, NONCE);

  if (TYPE === "burst") {
    sleep(burstOffset(createRng(seed), BURST_WINDOW_S));
    const reads: Action[] = OPEN_APP_READS.map((name) => ({ kind: "read", name }));
    runActions(reads, io, newLifterState({ seed: payload, routineId: lifter.routineId, plannedWeights: weights }));
    return;
  }

  const { actions } = buildSession({ seed, sets: SETS, pushFactor: PUSH });
  // The first session joins part-way so every step carries the full mix (AC13); later ones start from the top.
  const plan = iteration === 0 ? joinedActions(actions, joinAt(actions, createRng(seed * 7919))) : actions;
  runActions(plan, io, newLifterState({ seed: payload, routineId: lifter.routineId, plannedWeights: weights }));
}

export function handleSummary(summary: unknown): Record<string, string> {
  return { [SUMMARY_PATH]: JSON.stringify(summary) };
}
