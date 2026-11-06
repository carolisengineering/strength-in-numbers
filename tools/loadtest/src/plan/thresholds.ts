import { SERVER_ERROR_RATE_MAX, SET_SAVE_P95_MS } from "./constants.ts";
import type { RunType } from "./schedule.ts";

/**
 * Spec 16 AC7 — X, the one place: per step, set-save p95 < 2000 ms, 5xx rate < 1% and zero 429s. Only
 * `phase=measure` requests carry a `step` number, so warm-up and ramps match nothing (AC10). A burst sends no set
 * saves, so it is judged on 5xx and 429 only.
 */
export function buildThresholds(stepCount: number, type: RunType = "gym"): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let k = 1; k <= stepCount; k += 1) {
    if (type !== "burst") out[`http_req_duration{name:set_save,phase:measure,step:${k}}`] = [`p(95)<${SET_SAVE_P95_MS}`];
    out[`server_errors{phase:measure,step:${k}}`] = [`rate<${SERVER_ERROR_RATE_MAX}`];
    out[`rate_limited{phase:measure,step:${k}}`] = ["count<1"];
  }
  return out;
}

/**
 * What feeds the `server_errors` rate: a 5xx, or k6's status 0 (connection refused or reset, or a timeout), since a
 * request that never got an answer has gone wrong too (final review). On Render and Cloud Run the proxy turns a dead
 * process into a 5xx; locally and for client timeouts only status 0 shows it.
 */
export function countsAsServerError(status: number): boolean {
  return status === 0 || status >= 500;
}

/** The threshold keys a sample of `metric` with these tags counts toward (k6's tag-filter rule: every filter matches). */
export function thresholdsMatching(
  thresholds: Record<string, string[]>,
  metric: string,
  tags: Record<string, string>,
): string[] {
  return Object.keys(thresholds).filter((key) => {
    const m = /^([^{]+)\{(.*)\}$/.exec(key);
    if (!m || m[1] !== metric) return false;
    return m[2]!.split(",").every((pair) => {
      const [k, v] = pair.split(":");
      return tags[k!] === v;
    });
  });
}
