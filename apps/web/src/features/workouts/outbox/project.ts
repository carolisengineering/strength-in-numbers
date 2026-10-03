import { parseSetEntryId, toCanonicalMeters, type SetEntry, type WorkoutDetail } from "@sin/core";
import type { CreateOp, IdMap, OpTarget, OutboxOp } from "./ops";

export type RowSync = { state: "pending" } | { state: "failed"; opId: string; status: number };

export interface Projection {
  workout: WorkoutDetail;
  /** Keyed by the row's `id` as shown; synced rows are absent. */
  sync: ReadonlyMap<string, RowSync>;
}

type WorkoutExerciseDetail = WorkoutDetail["exercises"][number];

const LB_TO_KG = 0.45359237;

/** Does `row` hold the set `target` names? A row still shown under its client key matches its server id too. */
export function matches(row: SetEntry, target: OpTarget, idMap: IdMap): boolean {
  if ("setId" in target) {
    return (
      row.id === target.setId ||
      (row.clientGeneratedId !== null && idMap[row.clientGeneratedId]?.setId === target.setId)
    );
  }
  return row.id === target.clientGeneratedId || row.clientGeneratedId === target.clientGeneratedId;
}

/** Apply a create / update body to a row, recomputing the canonical measures as the server would. */
function withFields(row: SetEntry, body: Record<string, unknown>, at: number): SetEntry {
  const fields = Object.fromEntries(
    Object.entries(body).filter(([key, value]) => value !== undefined && key !== "clientGeneratedId"),
  );
  const merged = { ...row, ...fields } as SetEntry;
  const iso = new Date(at).toISOString();
  return {
    ...merged,
    weightKg:
      merged.weight === null || merged.weightUnit === null
        ? null
        : merged.weightUnit === "lb"
          ? merged.weight * LB_TO_KG
          : merged.weight,
    distanceM:
      merged.distance === null || merged.distanceUnit === null
        ? null
        : toCanonicalMeters(merged.distance, merged.distanceUnit),
    completedAt: merged.isComplete ? (row.completedAt ?? iso) : null,
    updatedAt: iso,
  };
}

function newRow(op: CreateOp, exercise: WorkoutExerciseDetail, setNumber: number): SetEntry {
  const iso = new Date(op.enqueuedAt).toISOString();
  const blank: SetEntry = {
    id: parseSetEntryId(op.target.clientGeneratedId),
    workoutExerciseId: exercise.id,
    clientGeneratedId: op.target.clientGeneratedId,
    setNumber,
    setType: "working",
    reps: null,
    weight: null,
    weightUnit: null,
    weightKg: null,
    distance: null,
    distanceUnit: null,
    distanceM: null,
    durationS: null,
    rpe: null,
    isComplete: false,
    completedAt: null,
    createdAt: iso,
    updatedAt: iso,
  };
  return withFields(blank, op.body, op.enqueuedAt);
}

function mark(sync: Map<string, RowSync>, rowId: string, op: OutboxOp): void {
  if (op.status === "failed") {
    sync.set(rowId, { state: "failed", opId: op.id, status: op.failure?.status ?? 0 });
  } else if (sync.get(rowId)?.state !== "failed") {
    sync.set(rowId, { state: "pending" });
  }
}

/**
 * The workout the screen shows: `workout` (a server copy, or one already projected — the result is
 * the same) with every queued op for it applied in order (Spec 06.2 AC1). Pure.
 */
export function project(
  workout: WorkoutDetail,
  { ops, idMap }: { ops: readonly OutboxOp[]; idMap: IdMap },
): Projection {
  const sync = new Map<string, RowSync>();
  let exercises = workout.exercises;
  for (const op of ops) {
    if (op.workoutId !== workout.id) continue;
    const index = exercises.findIndex((e) => e.id === op.workoutExerciseId);
    if (index < 0) continue;
    const exercise = exercises[index]!;
    let sets = exercise.sets;
    if (op.kind === "create") {
      const key = op.target.clientGeneratedId;
      if (!sets.some((s) => matches(s, op.target, idMap))) {
        sets = [...sets, newRow(op, exercise, Math.max(0, ...sets.map((s) => s.setNumber)) + 1)];
      } else if (sets.some((s) => s.id === key)) {
        // A local row from an earlier projection: rebuild it from the create's current (merged) body.
        sets = sets.map((s) => (s.id === key ? newRow(op, exercise, s.setNumber) : s));
      }
    } else if (op.kind === "update") {
      sets = sets.map((s) => (matches(s, op.target, idMap) ? withFields(s, op.body, op.enqueuedAt) : s));
    } else if (op.status !== "failed") {
      sets = sets.filter((s) => !matches(s, op.target, idMap));
    }
    if (sets !== exercise.sets) exercises = exercises.map((e, i) => (i === index ? { ...e, sets } : e));
    if (op.kind !== "delete" || op.status === "failed") {
      const row = sets.find((s) => matches(s, op.target, idMap));
      if (row) mark(sync, row.id, op);
    }
  }
  return { workout: exercises === workout.exercises ? workout : { ...workout, exercises }, sync };
}
