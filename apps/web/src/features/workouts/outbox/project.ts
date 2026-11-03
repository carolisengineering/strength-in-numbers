import {
  parseSetEntryId,
  toCanonicalMeters,
  type SectionResult,
  type SetEntry,
  type SetSectionResult,
  type WorkoutDetail,
  type WorkoutSection,
} from "@sin/core";
import { isSectionOp, type CreateOp, type IdMap, type OpTarget, type OutboxOp, type SectionOp } from "./ops";

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
    calories: null,
    rpe: null,
    isComplete: false,
    completedAt: null,
    createdAt: iso,
    updatedAt: iso,
  };
  return withFields(blank, op.body, op.enqueuedAt);
}

/** Spec 10.7 AC38: a result body as the server stores it — every key present, `capped` false by default. */
export function resultFromBody(body: SetSectionResult): SectionResult {
  return { rounds: body.rounds ?? null, reps: body.reps ?? null, finishSeconds: body.finishSeconds ?? null, capped: body.capped ?? false };
}

const sameResult = (a: SectionResult | null, b: SectionResult | null): boolean =>
  a === null || b === null ? a === b : a.rounds === b.rounds && a.reps === b.reps && a.finishSeconds === b.finishSeconds && a.capped === b.capped;

/** One timer entry applied to its section; the same object back when nothing changes (so projection is reference-stable). */
function withSectionOp(section: WorkoutSection, op: SectionOp): WorkoutSection {
  if (op.kind === "result") {
    const result = op.body === null ? null : resultFromBody(op.body);
    return sameResult(section.result, result) ? section : { ...section, result };
  }
  const current = section.roundTimes.find((t) => t.round === op.round);
  const { seconds } = op.body;
  if (seconds === null) return current === undefined ? section : { ...section, roundTimes: section.roundTimes.filter((t) => t.round !== op.round) };
  if (current?.seconds === seconds) return section;
  const roundTimes = [...section.roundTimes.filter((t) => t.round !== op.round), { round: op.round, seconds }].sort((a, b) => a.round - b.round);
  return { ...section, roundTimes };
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
  let sections = workout.sections;
  for (const op of ops) {
    if (op.workoutId !== workout.id) continue;
    if (isSectionOp(op)) {
      // Spec 10.7 AC38: a timer entry overlays the section (queued, sending and failed alike, like a note).
      const index = sections.findIndex((s) => s.id === op.sectionId);
      if (index < 0) continue;
      const section = sections[index]!;
      const next = withSectionOp(section, op);
      if (next !== section) sections = sections.map((s, i) => (i === index ? next : s));
      mark(sync, section.id, op);
      continue;
    }
    const index = exercises.findIndex((e) => e.id === op.workoutExerciseId);
    if (index < 0) continue;
    const exercise = exercises[index]!;
    if (op.kind === "note") {
      // Spec 10.3 AC13: overlay in queue order (the later edit wins); mark under the EXERCISE id (ids cannot collide with set ids).
      if (exercise.notes !== op.body.notes) {
        const updated = { ...exercise, notes: op.body.notes, updatedAt: new Date(op.enqueuedAt).toISOString() };
        exercises = exercises.map((e, i) => (i === index ? updated : e));
      }
      mark(sync, exercise.id, op);
      continue;
    }
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
  const changed = exercises !== workout.exercises || sections !== workout.sections;
  return { workout: changed ? { ...workout, exercises, sections } : workout, sync };
}
