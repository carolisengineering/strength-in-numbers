/**
 * Spec 07.4 §6.4 — Change Time's one pure rule set, shared by the API repository and (for
 * pre-validation) the client. DB-free and clock-injected, like 05.0's `workout-writes.ts`.
 */
import { NOT_WITH_ENDED_AT, REQUIRES_START, WORKOUT_FUTURE_SKEW_MAX_MS, WORKOUT_START_EDIT_FLOOR } from "./dto/workout.js";

// Static `422` messages (CLAUDE.md #57): never a value. Bare constants, so the #57 source scan can see them.
const FUTURE = "must not be more than 5 minutes in the future";
const FLOOR = "must not be before 2000-01-01";
const ENDS_IN_FUTURE = "would end in the future";
const BEFORE_START = "must not be before startedAt";
const FINISHED_DURATION_NULL = "not allowed on a finished workout";

/** Every Change Time message; `requiresStart` / `notWithEndedAt` are the request schema's refines. */
export const RETIME_MESSAGES = {
  future: FUTURE,
  floor: FLOOR,
  endsInFuture: ENDS_IN_FUTURE,
  beforeStart: BEFORE_START,
  requiresStart: REQUIRES_START,
  notWithEndedAt: NOT_WITH_ENDED_AT,
  finishedDurationNull: FINISHED_DURATION_NULL,
} as const;

export interface RetimeCurrent {
  startedAt: Date;
  endedAt: Date | null;
  plannedDurationS: number | null;
}

export interface RetimePatch {
  startedAt?: string;
  durationSeconds?: number | null;
  endedAt?: string | null;
}

export type RetimeField = "startedAt" | "endedAt" | "durationSeconds";

export type RetimeResult =
  | { ok: true; startedAt: Date; endedAt: Date | null; plannedDurationS: number | null; startChanged: boolean; endChanged: boolean }
  | { ok: false; path: RetimeField; message: string }; // always one of RETIME_MESSAGES

const FLOOR_MS = Date.parse(WORKOUT_START_EDIT_FLOOR);

/**
 * The times a `PATCH /v1/workouts/{id}` leaves the workout with, or the field error it fails on.
 * A `startedAt` equal to the stored one (same ms) is no change and skips the bound check (AC23).
 * PRECONDITION: the caller has already refused a non-null `endedAt` on a finished workout
 * (`WorkoutFinishedError`, D17); here a finished workout's `endedAt` key is ignored.
 */
export function resolveRetime(current: RetimeCurrent, patch: RetimePatch, now: Date): RetimeResult {
  const latest = now.getTime() + WORKOUT_FUTURE_SKEW_MAX_MS;
  const sentStart = patch.startedAt === undefined ? undefined : Date.parse(patch.startedAt);
  const startChanged = sentStart !== undefined && sentStart !== current.startedAt.getTime();
  if (startChanged) {
    if (sentStart > latest) return { ok: false, path: "startedAt", message: FUTURE };
    if (sentStart < FLOOR_MS) return { ok: false, path: "startedAt", message: FLOOR };
  }
  const startMs = startChanged ? sentStart : current.startedAt.getTime();
  const startedAt = new Date(startMs);
  const endBlame: RetimeField = patch.durationSeconds !== undefined ? "durationSeconds" : "startedAt";

  if (current.endedAt !== null) {
    if (patch.durationSeconds === null) return { ok: false, path: "durationSeconds", message: FINISHED_DURATION_NULL };
    const durationMs = patch.durationSeconds !== undefined
      ? patch.durationSeconds * 1000
      : current.endedAt.getTime() - current.startedAt.getTime();
    const endMs = startMs + durationMs;
    if (endMs > latest) return { ok: false, path: endBlame, message: ENDS_IN_FUTURE };
    return { ok: true, startedAt, endedAt: new Date(endMs), plannedDurationS: null, startChanged, endChanged: endMs !== current.endedAt.getTime() };
  }

  if (patch.endedAt != null) {
    const endMs = Date.parse(patch.endedAt);
    if (endMs < startMs) return { ok: false, path: "endedAt", message: BEFORE_START };
    if (endMs > latest) return { ok: false, path: "endedAt", message: FUTURE };
    return { ok: true, startedAt, endedAt: new Date(endMs), plannedDurationS: null, startChanged, endChanged: true };
  }

  const plan = patch.durationSeconds !== undefined ? patch.durationSeconds : current.plannedDurationS;
  if (plan !== null && startMs + plan * 1000 > latest) return { ok: false, path: endBlame, message: ENDS_IN_FUTURE };
  return { ok: true, startedAt, endedAt: null, plannedDurationS: plan, startChanged, endChanged: false };
}
