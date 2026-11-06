import {
  BURST_WINDOW_S,
  MIN_SAVES_PER_STEP,
  RAMP_S,
  REST_MAX_S,
  REST_MIN_S,
  SET_WORK_S,
  WARMUP_MAX_S,
  WARMUP_REQUESTS,
} from "./constants.ts";
import { OPEN_APP_READS } from "./session.ts";

/** Spec 16 AC10, AC12, AC14 — how lifters are stepped up, and which step a moment belongs to. */
export type RunType = "gym" | "push" | "burst";

export interface Stage {
  lifters: number;
  /** Quiet or ramping time before the measured hold. */
  rampS: number;
  /** The measured part of the step. */
  holdS: number;
}

export interface Schedule {
  /** The setup budget for waking the target (polled /healthz), before scenario time 0. */
  warmupS: number;
  pushFactor: number;
  stages: Stage[];
}

/** A burst lifter's requests continue a little past the arrival window. */
const BURST_TAIL_S = 30;

const meanRestS = (pushFactor: number) => (REST_MIN_S + REST_MAX_S) / 2 / pushFactor;

/** One set's mean cycle: time under the bar plus the mean rest. */
export function meanSetCycleS(pushFactor: number): number {
  return SET_WORK_S + meanRestS(pushFactor);
}

/** One session's mean length: every set plus a rest between consecutive sets. */
export function meanSessionS(sessionSets: number[], pushFactor: number): number {
  const total = sessionSets.reduce((n, s) => n + s, 0);
  return total * SET_WORK_S + Math.max(0, total - 1) * meanRestS(pushFactor);
}

/**
 * Gym and push runs (AC12): each step ramps, then holds long enough for MIN_SAVES_PER_STEP expected set saves and
 * for one mean session, so lifters that joined part-way finish inside the step. A full gym run takes hours.
 */
export function gymSchedule(steps: number[], sessionSets: number[], pushFactor = 1): Schedule {
  const sessionS = Math.ceil(meanSessionS(sessionSets, pushFactor));
  return {
    warmupS: WARMUP_MAX_S,
    pushFactor,
    stages: steps.map((lifters) => ({
      lifters,
      rampS: RAMP_S,
      holdS: Math.max(Math.ceil((MIN_SAVES_PER_STEP * meanSetCycleS(pushFactor)) / lifters), sessionS),
    })),
  };
}

/** Burst runs (AC14): each step is K lifters arriving within BURST_WINDOW_S, after a quiet gap. */
export function burstSchedule(steps: number[]): Schedule {
  return {
    warmupS: WARMUP_MAX_S,
    pushFactor: 1,
    stages: steps.map((lifters) => ({ lifters, rampS: RAMP_S, holdS: BURST_WINDOW_S + BURST_TAIL_S })),
  };
}

/** A burst lifter's arrival offset, uniform in [0, window] s. */
export function burstOffset(rng: () => number, windowS: number): number {
  return rng() * windowS;
}

/** The k6 `scenarios` option. Gym and push: one ramping-vus scenario. Burst: one per-vu-iterations scenario per step. */
export function toK6Scenario(s: Schedule, type: RunType): Record<string, object> {
  if (type !== "burst") {
    return {
      lifters: {
        executor: "ramping-vus",
        startVUs: 0,
        stages: s.stages.flatMap((st) => [
          { duration: `${st.rampS}s`, target: st.lifters },
          { duration: `${st.holdS}s`, target: st.lifters },
        ]),
        gracefulRampDown: "60s",
        gracefulStop: "60s",
      },
    };
  }
  const scenarios: Record<string, object> = {};
  let t = 0;
  s.stages.forEach((st, i) => {
    scenarios[`burst_${i + 1}`] = {
      executor: "per-vu-iterations",
      vus: st.lifters,
      iterations: 1,
      startTime: `${t + st.rampS}s`,
      maxDuration: `${st.holdS}s`,
      gracefulStop: "30s",
    };
    t += st.rampS + st.holdS;
  });
  return scenarios;
}

/**
 * The step and phase of a moment, `elapsedMs` after scenario time 0 (the end of setup). Before 0 is the warm-up;
 * ramps and the time after the last hold are never measured (AC10).
 */
export function stepAt(s: Schedule, elapsedMs: number): { step: string; phase: "warmup" | "ramp" | "measure" } {
  if (elapsedMs < 0) return { step: "warmup", phase: "warmup" };
  const e = elapsedMs / 1000;
  let t = 0;
  for (const [i, st] of s.stages.entries()) {
    if (e < t + st.rampS) return { step: "ramp", phase: "ramp" };
    if (e < t + st.rampS + st.holdS) return { step: String(i + 1), phase: "measure" };
    t += st.rampS + st.holdS;
  }
  return { step: "ramp", phase: "ramp" };
}

/** Requests a run will send, for `--dry-run` (rough: a lifter sends one session's requests per mean session length). */
export function estimateRequests(s: Schedule, sessionSets: number[], type: RunType): number {
  if (type === "burst") return s.stages.reduce((n, st) => n + st.lifters * OPEN_APP_READS.length, 0) + WARMUP_REQUESTS;
  const total = sessionSets.reduce((n, x) => n + x, 0);
  const perSession = OPEN_APP_READS.length + 1 + total + 3;
  const sessionS = meanSessionS(sessionSets, s.pushFactor);
  const lifting = s.stages.reduce((n, st) => n + (st.lifters * (st.rampS / 2 + st.holdS) * perSession) / sessionS, 0);
  return Math.ceil(lifting) + WARMUP_REQUESTS;
}
