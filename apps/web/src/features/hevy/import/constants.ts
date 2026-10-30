import { HEVY_IMPORT_BATCH_MAX } from "@sin/core";

/** Spec 20.1 §8: the import's limits and pacing, beside the screen (no env, no flag). */

/** AC6: at most this many workouts per request (19.1's batch cap). */
export const BATCH_WORKOUTS_MAX = HEVY_IMPORT_BATCH_MAX;
/** AC6: about this many bytes of JSON per request; the server's 512 KiB body limit is the backstop. */
export const BATCH_BYTES_MAX = 400 * 1024;
/** AC8: the Hevy exercise titles used as section markers, compared after `trim().toLowerCase()`. */
export const MARKER_TITLES = Object.freeze(["warmup", "workout"] as const);
/** AC11: the wait after a `429` that carries no `Retry-After`. Phase B reuses it. */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 5000;
/** AC3: the reading stages, in order (`readHevy` re-exports the type). */
export const READ_STAGES = Object.freeze(["count", "templates", "folders", "routines", "workouts"] as const);
export type ReadStage = (typeof READ_STAGES)[number];
/** AC18: the gap between real batches (the server is the bottleneck; the `hevy` group allows 60 a minute). */
export const BATCH_GAP_MS = 250;
/** AC19: the waits before re-sending a batch after a network error or a `5xx`; after the last, the run pauses. */
export const BATCH_RETRY_WAITS_MS = Object.freeze([2000, 4000, 8000] as const);
/** AC23: the gap between routine creates (no more than 20 a minute). */
export const ROUTINE_GAP_MS = 3000;
