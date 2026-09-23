/**
 * Pure, DB-free helpers for the workout write paths (Spec 05.0 §6.4, §6.7,
 * D43, D47) — unit-testable with an injected clock, no database. Shared by
 * `workout.prisma.ts` and (for arithmetic) `FakeWorkoutRepository`.
 */
import { WORKOUT_FUTURE_SKEW_MAX_MS, WORKOUT_STARTED_AT_PAST_MAX_MS } from "@sin/core";
import { ValidationError } from "../errors/app-error.js";

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

/** §6.4/§6.5: endedAt on finish uses the same future bound as startedAt. */
export function assertEndedAtInBounds(endedAt: Date, now: Date): void {
  const deltaMs = endedAt.getTime() - now.getTime();
  if (deltaMs > WORKOUT_FUTURE_SKEW_MAX_MS) {
    fieldError("endedAt", "must not be more than 5 minutes in the future");
  }
}

/** §6.5: endedAt >= startedAt; equality allowed. */
export function assertEndedAtNotBeforeStartedAt(startedAt: Date, endedAt: Date): void {
  if (endedAt.getTime() < startedAt.getTime()) {
    fieldError("endedAt", "must not be before startedAt");
  }
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
