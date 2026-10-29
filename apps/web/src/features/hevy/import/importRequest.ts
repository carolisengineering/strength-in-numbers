import {
  HevyImportWorkoutSchema,
  offsetMinutesForZone,
  type HevyImportExercise,
  type HevyImportSetInput,
  type HevyImportWorkout,
  type HevySet,
  type HevyWorkout,
} from "@sin/core";

import { BATCH_BYTES_MAX, BATCH_WORKOUTS_MAX } from "./constants";

/** Spec 20.1 AC6: a Hevy workout as the 19.1 import request carries it. Pure. */

export type ImportRequestResult = { ok: true; workout: HevyImportWorkout } | { ok: false; reason: "unreadable" };

const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

/** Sorts by Hevy `index`; an item without one keeps its array position (a stable sort over the original order). */
function byIndex<T extends { index?: number | null }>(list: readonly T[]): T[] {
  return list
    .map((item, position) => ({ item, key: item.index ?? position, position }))
    .sort((a, b) => a.key - b.key || a.position - b.position)
    .map(({ item }) => item);
}

function toSet(s: HevySet): HevyImportSetInput {
  return {
    // An unknown set type is caught by the schema check below (D9).
    type: s.type as HevyImportSetInput["type"],
    weightKg: orNull(s.weight_kg),
    reps: orNull(s.reps),
    distanceMeters: orNull(s.distance_meters),
    durationSeconds: orNull(s.duration_seconds),
    rpe: orNull(s.rpe),
    customMetric: orNull(s.custom_metric),
  };
}

/**
 * Builds the strict request object. The offset is the device zone's at this workout's own start, so DST is right
 * per workout. A workout the schema rejects (an unknown set type, D9, or anything over the request's bounds, O2)
 * is `unreadable`: it is never sent, because one bad workout would fail its whole batch.
 */
export function toImportWorkout(w: HevyWorkout, ctx: { zone: string }): ImportRequestResult {
  let tzOffsetMinutes: number;
  try {
    tzOffsetMinutes = offsetMinutesForZone(w.start_time, ctx.zone);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const exercises: HevyImportExercise[] = byIndex(w.exercises).map((e) => ({
    exerciseTemplateId: e.exercise_template_id,
    notes: orNull(e.notes),
    supersetId: orNull(e.superset_id),
    sets: byIndex(e.sets).map(toSet),
  }));
  const candidate: HevyImportWorkout = {
    hevyWorkoutId: w.id,
    title: w.title,
    description: orNull(w.description),
    startTime: w.start_time,
    endTime: w.end_time,
    tzOffsetMinutes,
    exercises,
  };
  const parsed = HevyImportWorkoutSchema.safeParse(candidate);
  return parsed.success ? { ok: true, workout: parsed.data } : { ok: false, reason: "unreadable" };
}

/**
 * D5 / 19.1 O1: newest `start_time` first, ties by `id` ascending. The one place the import's order is decided.
 * Compares instants, so an offset start sorts by when it happened.
 */
export function sortNewestFirst<T extends { start_time: string; id: string }>(list: readonly T[]): T[] {
  const at = (t: T) => Date.parse(t.start_time);
  return [...list].sort((a, b) => at(b) - at(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const encoder = new TextEncoder();
const bytesOf = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
/** The batch body around the workouts: `{"dryRun":false,"workouts":[` … `]}`. */
const ENVELOPE_BYTES = bytesOf({ dryRun: false, workouts: [] });

/**
 * AC6: batches of at most `count` workouts and about `bytes` of JSON, in input order, never splitting a workout.
 * A single workout over the byte bound goes alone (the server's 512 KiB limit is the backstop).
 */
export function chunkBatches(
  workouts: readonly HevyImportWorkout[],
  limits: { count: number; bytes: number } = { count: BATCH_WORKOUTS_MAX, bytes: BATCH_BYTES_MAX },
): HevyImportWorkout[][] {
  const batches: HevyImportWorkout[][] = [];
  let current: HevyImportWorkout[] = [];
  let size = ENVELOPE_BYTES;
  for (const w of workouts) {
    const own = bytesOf(w);
    // One byte for the comma between workouts.
    if (current.length > 0 && (current.length >= limits.count || size + 1 + own > limits.bytes)) {
      batches.push(current);
      current = [];
      size = ENVELOPE_BYTES;
    }
    size += own + (current.length > 0 ? 1 : 0);
    current.push(w);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
