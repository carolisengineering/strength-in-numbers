/** Spec 16 — the builder's constants (§10). One place; tests and the k6 script import these. */

/** Real gym pace: a rest between sets is uniform in [REST_MIN_S, REST_MAX_S] (AC3). */
export const REST_MIN_S = 90;
export const REST_MAX_S = 180;
/** Time under the bar per set, before the save. */
export const SET_WORK_S = 40;

/** Set saves a step needs before its p95 means something (AC12). */
export const MIN_SAVES_PER_STEP = 200;

export const GYM_STEPS: readonly number[] = [10, 25, 50, 75, 100, 150];
export const BURST_STEPS: readonly number[] = [10, 20, 30, 50, 100];
/** A burst's lifters all arrive within this window (AC14). */
export const BURST_WINDOW_S = 60;
/** Ramp between gym steps. */
export const RAMP_S = 30;

/** Warm-up: poll /healthz for up to this long, then send this many tagged warm-up requests (AC10). */
export const WARMUP_MAX_S = 90;
export const WARMUP_REQUESTS = 5;

/** X, per step (AC7). */
export const SET_SAVE_P95_MS = 2000;
export const SERVER_ERROR_RATE_MAX = 0.01;
