import type { PlannedSet, WorkoutExerciseDetail } from "@sin/core";

import { formatWeight } from "../routines/targetFormat";
import { progressOf } from "./currentExercise";
import { SET_TYPE_LABELS } from "./format";
import type { RowSync } from "./outbox/project";
import type { SupersetRow } from "./supersetRows";

/** One collapsed exercise (Spec 17.1 §6.2): the visible line, its spoken name, and whether to draw the check. */
export interface CollapsedSummary {
  readonly text: string;
  readonly name: string;
  readonly done: boolean;
}

const setCount = (n: number): string => (n === 1 ? "1 set" : `${n} sets`);

function repsText(row: PlannedSet): string | null {
  if (row.repsLow === null) return null;
  return row.repsHigh !== null && row.repsHigh !== row.repsLow ? `${row.repsLow}–${row.repsHigh}` : `${row.repsLow}`;
}

/** The next planned row as "185 × 5"; `unitAlways` for the spoken name, which always carries the unit. */
function nextText(exercise: WorkoutExerciseDetail, row: PlannedSet, logged: number, unitPreference: "kg" | "lb", unitAlways: boolean): string {
  const reps = repsText(row);
  const unit = row.weightUnit !== null && (unitAlways || row.weightUnit !== unitPreference) ? ` ${row.weightUnit}` : "";
  const weight = row.weight === null ? null : `${formatWeight(row.weight)}${unit}`;
  const repsOnly = reps === null ? `set ${logged + 1}` : reps === "1" ? "1 rep" : `${reps} reps`;
  let core: string;
  switch (exercise.modalitySnapshot) {
    case "weight_reps":
      core = weight !== null && reps !== null ? `${weight} × ${reps}` : repsOnly;
      break;
    case "weighted_bodyweight":
      core = weight !== null && reps !== null ? `+${weight} × ${reps}` : repsOnly;
      break;
    case "bodyweight_reps":
      core = repsOnly;
      break;
    default:
      core = `set ${logged + 1}`;
  }
  return row.setType === "working" ? core : `${core} · ${SET_TYPE_LABELS[row.setType]}`;
}

/** Spec 17.1 AC10, the §6.2 table. Pure. */
export function collapsedSummary(row: SupersetRow, unitPreference: "kg" | "lb"): CollapsedSummary {
  const { exercise, ordinal, line } = row;
  const name = exercise.exerciseNameSnapshot;
  const { planned, logged } = progressOf(exercise);
  const spoken = (detail: string) => [name, ordinal === null ? null : `superset ${ordinal}`, detail].filter((p): p is string => p !== null).join(", ");
  const next = planned > logged ? exercise.plannedSets[logged]! : null;

  if (planned > 0 && logged >= planned) return { text: `${name} · ${setCount(logged)}`, name: spoken(`${setCount(logged)} logged`), done: true };
  if (next !== null && logged > 0) {
    return {
      text: `${name} · ${logged} of ${planned} · next ${nextText(exercise, next, logged, unitPreference, false)}`,
      name: spoken(`${logged} of ${planned} sets logged, next ${nextText(exercise, next, logged, unitPreference, true)}`),
      done: false,
    };
  }
  if (next !== null) {
    return {
      text: `${name} · next ${nextText(exercise, next, logged, unitPreference, false)}`,
      name: spoken(`next ${nextText(exercise, next, logged, unitPreference, true)}`),
      done: false,
    };
  }
  if (logged > 0) return { text: `${name} · ${setCount(logged)}`, name: spoken(`${setCount(logged)} logged`), done: false };
  const detail = line === "" ? "no sets yet" : line;
  return { text: `${name} · ${detail}`, name: spoken(detail), done: false };
}

/** Spec 17.1 AC10 / 06.2: a collapsed row still says when any of its sets or its note is queued or failed. */
export function collapsedSync(exercise: Pick<WorkoutExerciseDetail, "id" | "sets">, sync: ReadonlyMap<string, RowSync>): "pending" | "failed" | null {
  const states = [sync.get(exercise.id)?.state, ...exercise.sets.map((s) => sync.get(s.id)?.state)];
  if (states.includes("failed")) return "failed";
  return states.includes("pending") ? "pending" : null;
}
