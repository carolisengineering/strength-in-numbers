/**
 * Pure, DB-free helpers for the workout write paths (Spec 05.0 §6.4, §6.7,
 * D43, D47) — unit-testable with an injected clock, no database. Shared by
 * `workout.prisma.ts` and (for arithmetic) `FakeWorkoutRepository`.
 */
import {
  resolveRetime,
  WORKOUT_FUTURE_SKEW_MAX_MS,
  WORKOUT_STARTED_AT_PAST_MAX_MS,
  type RetimeCurrent,
  type RetimePatch,
  type RetimeResult,
} from "@sin/core";
import { ValidationError } from "../errors/app-error.js";
import type { RetimeOutcome } from "./workout.js";

function fieldError(path: string, message: string): never {
  throw new ValidationError([{ path, message }], `${path}: ${message}`);
}

/** §6.4: startedAt must be within +5min / -7days of `now`. */
export function assertStartedAtInBounds(startedAt: Date, now: Date): void {
  const deltaMs = startedAt.getTime() - now.getTime();
  if (deltaMs > WORKOUT_FUTURE_SKEW_MAX_MS) {
    fieldError("startedAt", "must not be more than 5 minutes in the future");
  }
  if (deltaMs < -WORKOUT_STARTED_AT_PAST_MAX_MS) {
    fieldError("startedAt", "must not be more than 7 days in the past");
  }
}

/** Spec 07.4 §6.4: `resolveRetime`, with its field error thrown as a 422 (static message, #57). */
export function retimeOrThrow(current: RetimeCurrent, patch: RetimePatch, now: Date): Extract<RetimeResult, { ok: true }> {
  const result = resolveRetime(current, patch, now);
  if (!result.ok) fieldError(result.path, result.message);
  return result;
}

/** Spec 07.4 §9: what a Change Time did, for the route's `workout_retimed` line; null when the patch
 * carried neither `startedAt` nor `durationSeconds`. Shared by the repository and the fake. */
export function retimeOutcome(
  patch: { startedAt?: string; durationSeconds?: number | null },
  wasFinished: boolean,
  oldStart: Date,
  next: { startedAt: Date; endedAt: Date | null; plannedDurationS: number | null; startChanged: boolean },
  recordsRecomputed: boolean,
): RetimeOutcome | null {
  if (patch.startedAt === undefined && patch.durationSeconds === undefined) return null;
  return {
    wasFinished,
    startShiftSeconds: next.startChanged ? Math.round((next.startedAt.getTime() - oldStart.getTime()) / 1000) : null,
    durationSeconds: next.endedAt !== null
      ? Math.round((next.endedAt.getTime() - next.startedAt.getTime()) / 1000)
      : next.plannedDurationS,
    startedAt: next.startedAt,
    recordsRecomputed,
  };
}

/** §6.7: add with no `position` appends at the current count `n`. */
export function computeAppendPosition(n: number): number {
  return n;
}

/** §6.7/D43: add-with-position requires 0 <= position <= n. This is what
 * keeps `position` inside `smallint` — it rejects everything above 32767
 * long before the column would see it, since a real workout's `n` is a few
 * dozen at most. */
export function assertAddPositionInRange(position: number, n: number): void {
  if (position < 0 || position > n) {
    fieldError("position", `must be between 0 and ${n} inclusive`);
  }
}

/** §6.7/D43: reorder requires 0 <= position <= n-1. */
export function assertReorderPositionInRange(position: number, n: number): void {
  if (position < 0 || position > n - 1) {
    fieldError("position", `must be between 0 and ${n - 1} inclusive`);
  }
}
