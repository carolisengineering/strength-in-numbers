import { SERVER_ERROR_RATE_MAX, SET_SAVE_P95_MS } from "./constants.ts";
import type { RunType } from "./schedule.ts";
import type { TargetName } from "./targets.ts";

/** Spec 16 AC8, AC9 — per-step results from k6's summary, and the owner's sentence. */

export const X_SET_SAVE = "set-save p95 over 2 s";
export const X_SERVER_ERRORS = "5xx rate over 1%";
export const X_RATE_LIMITED = "a rate-limited request (429)";
export const X_NO_SET_SAVES = "no set saves measured";
export const X_NOTHING = "nothing failed up to the largest step tried";
export const X_NO_STEP = "no measured step";

export interface StepResult {
  step: number;
  lifters: number;
  /** False when the summary has no measured samples for the step (the run ended first, or k6 crashed). */
  measured: boolean;
  p95Ms: number | null;
  errorRate: number | null;
  rateLimited: number;
  pass: boolean;
  /** The first X the step broke, in the order set-save p95, 5xx, 429; `null` when it passed. */
  failedOn: string | null;
}

function metricValue(summary: unknown, key: string, field: string): number | null {
  const metrics = (summary as { metrics?: Record<string, { values?: Record<string, unknown> }> } | undefined)?.metrics;
  const v = metrics?.[key]?.values?.[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `lifters[k-1]` is step k's lifter count. Tolerates an undefined, empty or partial summary. */
export function stepResults(summary: unknown, lifters: number[], type: RunType): StepResult[] {
  return lifters.map((count, i) => {
    const k = i + 1;
    const p95Ms = metricValue(summary, `http_req_duration{name:set_save,phase:measure,step:${k}}`, "p(95)");
    const errorRate = metricValue(summary, `server_errors{phase:measure,step:${k}}`, "rate");
    const rateLimited = metricValue(summary, `rate_limited{phase:measure,step:${k}}`, "count") ?? 0;
    const measured = errorRate !== null;
    let failedOn: string | null = null;
    if (!measured) failedOn = X_NO_STEP;
    else if (type !== "burst" && p95Ms === null) failedOn = X_NO_SET_SAVES;
    else if (type !== "burst" && p95Ms! >= SET_SAVE_P95_MS) failedOn = X_SET_SAVE;
    else if (errorRate >= SERVER_ERROR_RATE_MAX) failedOn = X_SERVER_ERRORS;
    else if (rateLimited >= 1) failedOn = X_RATE_LIMITED;
    return { step: k, lifters: count, measured, p95Ms, errorRate, rateLimited, pass: failedOn === null, failedOn };
  });
}

export interface Report {
  n: number | null;
  x: string;
  sentence: string;
  nonMonotonic: boolean;
}

function noun(type: RunType, pushFactor: number): string {
  if (type === "push") return `equivalent lifters at ×${pushFactor} pace`;
  if (type === "burst") return "lifters opening the app within a minute";
  return "lifters mid-workout at the same time";
}

/** N = the highest passing step; X = what the next step broke. A failure below N is reported, not hidden. */
export function report(input: { target: TargetName; type: RunType; pushFactor: number; steps: StepResult[] }): Report {
  const { target, type, pushFactor } = input;
  if (type === "push" && !(pushFactor > 1)) throw new Error("a push result needs a push factor above 1");
  const steps = input.steps.filter((s) => s.measured);
  if (steps.length === 0) {
    return { n: null, x: X_NO_STEP, nonMonotonic: false, sentence: `${target}: no measured step; the run ended before any step was measured` };
  }
  const best = steps.map((s) => s.pass).lastIndexOf(true);
  if (best < 0) {
    const first = steps[0]!;
    const x = first.failedOn!;
    return {
      n: null,
      x,
      nonMonotonic: false,
      sentence: `${target}: no step passed; the first step (${first.lifters} lifters) failed on ${x}`,
    };
  }
  const n = steps[best]!.lifters;
  const below = steps.slice(0, best).find((s) => !s.pass);
  const next = steps[best + 1];
  const x = next ? next.failedOn! : X_NOTHING;
  let sentence = next
    ? `${target} handles ${n} ${noun(type, pushFactor)} before ${x} goes wrong`
    : `${target} handles ${n} ${noun(type, pushFactor)}; ${X_NOTHING}`;
  if (below) sentence += ` (non-monotonic: the ${below.lifters}-lifter step failed on ${below.failedOn} although a larger step passed)`;
  return { n, x, nonMonotonic: below !== undefined, sentence };
}
