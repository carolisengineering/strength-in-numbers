import { intBetween, uuidFrom } from "./rng.ts";

/** Spec 16 AC4 — request bodies a lifter sends. Every one passes its `@sin/core` schema (tested over 1,000 seeds). */

/** `2026-11-06T10:00:00.000Z` → `2026-11-06T10:00:00.000+00:00` (the schemas accept any offset). */
function isoWithOffset(at: Date): string {
  return at.toISOString().replace("Z", "+00:00");
}

/** POST /v1/workouts — start from the seeded routine. */
export function startBody(routineId: string, rng: () => number, now: Date): object {
  return { clientGeneratedId: uuidFrom(rng), startedAt: isoWithOffset(now), tzOffsetMinutes: 0, routineId };
}

/** POST /v1/workout-exercises/{id}/sets — a complete working set near the planned weight (none for bodyweight). */
export function setBody(rng: () => number, plannedWeightKg: number | null): object {
  const base = { clientGeneratedId: uuidFrom(rng), setType: "working", reps: intBetween(rng, 5, 8), isComplete: true };
  if (plannedWeightKg === null) return base;
  const weight = Math.max(0, plannedWeightKg + 2.5 * intBetween(rng, -2, 2));
  return { ...base, weight, weightUnit: "kg" };
}

/** PATCH /v1/workouts/{id} — finish. */
export function finishBody(now: Date): object {
  return { endedAt: isoWithOffset(now) };
}
