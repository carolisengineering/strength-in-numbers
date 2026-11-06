/**
 * Spec 16 — the k6 entry script. Thin: it reads its inputs from environment variables the CLI sets, runs each
 * lifter's plan through the pure executor, tags every request, and writes k6's summary for the CLI to report.
 * Imports only k6 modules and relative `.ts` paths (k6 loads them itself; AC1).
 *
 * Inputs (LOADTEST_LIFTERS holds tokens: in memory only, never logged):
 *   LOADTEST_LIFTERS  JSON [{ token, routineId, sets }]   lifter i uses entry i
 *   LOADTEST_TARGET, LOADTEST_BASE_URL, LOADTEST_TYPE (gym | push | burst), LOADTEST_PUSH,
 *   LOADTEST_SCHEDULE JSON Schedule, LOADTEST_SUMMARY_PATH
 */
import { sleep } from "k6";
import exec from "k6/execution";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";
import { BURST_WINDOW_S, WARMUP_MAX_S, WARMUP_REQUESTS } from "../src/plan/constants.ts";
import { newLifterState, runActions, type ExecutorIo } from "../src/plan/executor.ts";
import { createRng } from "../src/plan/rng.ts";
import { SEEDED_ITEMS } from "../src/plan/routine.ts";
import { burstOffset, stepAt, toK6Scenario, type RunType, type Schedule } from "../src/plan/schedule.ts";
import { OPEN_APP_READS, buildSession, joinAt, joinedActions, type Action } from "../src/plan/session.ts";
import { buildThresholds } from "../src/plan/thresholds.ts";
import type { TagKey } from "../src/plan/tags.ts";

interface Lifter {
  token: string;
  routineId: string;
  sets: number[];
}

const LIFTERS = JSON.parse(__ENV.LOADTEST_LIFTERS ?? "[]") as Lifter[];
const SCHEDULE = JSON.parse(__ENV.LOADTEST_SCHEDULE ?? '{"warmupS":0,"pushFactor":1,"stages":[]}') as Schedule;
const TYPE = (__ENV.LOADTEST_TYPE ?? "gym") as RunType;
const TARGET = __ENV.LOADTEST_TARGET ?? "local";
const BASE_URL = __ENV.LOADTEST_BASE_URL ?? "http://localhost:8080";
const PUSH = Number(__ENV.LOADTEST_PUSH ?? "1");
const SUMMARY_PATH = __ENV.LOADTEST_SUMMARY_PATH ?? "summary.json";

export const options = {
  scenarios: toK6Scenario(SCHEDULE, TYPE),
  thresholds: buildThresholds(SCHEDULE.stages.length, TYPE),
  summaryTrendStats: ["avg", "p(95)", "max"],
  setupTimeout: `${WARMUP_MAX_S + 60}s`,
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
      serverErrors.add(res.status >= 500, tags);
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
    serverErrors.add(res.status >= 500, tags);
  }
  return { t0: Date.now() };
}

const weights = SEEDED_ITEMS.map((i) => i.weightKg);

export default function (data: { t0: number }): void {
  const index = exec.vu.idInTest - 1;
  const lifter = LIFTERS[index];
  if (!lifter) throw new Error(`no account for lifter ${index + 1}; the CLI passes ${LIFTERS.length}`);
  const io = makeIo(lifter.token, data.t0);
  const iteration = exec.vu.iterationInInstance;
  const seed = (index + 1) * 100_003 + iteration;

  if (TYPE === "burst") {
    sleep(burstOffset(createRng(seed), BURST_WINDOW_S));
    const reads: Action[] = OPEN_APP_READS.map((name) => ({ kind: "read", name }));
    runActions(reads, io, newLifterState({ seed, routineId: lifter.routineId, plannedWeights: weights }));
    return;
  }

  const { actions } = buildSession({ seed, sets: lifter.sets, pushFactor: PUSH });
  // The first session joins part-way so every step carries the full mix (AC13); later ones start from the top.
  const plan = iteration === 0 ? joinedActions(actions, joinAt(actions, createRng(seed * 7919))) : actions;
  runActions(plan, io, newLifterState({ seed, routineId: lifter.routineId, plannedWeights: weights }));
}

export function handleSummary(summary: unknown): Record<string, string> {
  return { [SUMMARY_PATH]: JSON.stringify(summary) };
}
