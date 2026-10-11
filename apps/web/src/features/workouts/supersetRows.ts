import { isLinked, runOrdinals, runPosition, type RunPosition, type WorkoutExerciseDetail } from "@sin/core";
import { itemAccessibleName, targetLine } from "../routines/targetFormat";

export interface SupersetRow {
  readonly exercise: WorkoutExerciseDetail;
  readonly bracket: RunPosition;
  /** The run's ordinal on screen (Spec 10.1 D5) — never the stored `supersetGroup`. */
  readonly ordinal: number | null;
  readonly line: string;
  /** "Bench press, superset 1, 4 × 6–8" for a card in a run; `null` keeps the heading as the name. */
  readonly label: string | null;
  /** This row and the next share a run: the spacer between them carries the bracket. */
  readonly linkedBelow: boolean;
}

/** The one place the session screens derive superset display (Spec 10.1 AC17, AC24). */
export function supersetRows(exercises: readonly WorkoutExerciseDetail[]): SupersetRow[] {
  const sorted = [...exercises].sort((a, b) => a.position - b.position);
  const groups = sorted.map((e) => e.supersetGroup);
  const ordinals = runOrdinals(groups);
  const slots = sorted.map((e) => ({ id: e.id, group: e.supersetGroup }));
  return sorted.map((exercise, i) => {
    const ordinal = ordinals[i] ?? null;
    const line = targetLine(exercise);
    return {
      exercise,
      bracket: runPosition(groups, i),
      ordinal,
      line,
      label: ordinal === null ? null : itemAccessibleName(exercise.exerciseNameSnapshot, ordinal, line, false),
      linkedBelow: isLinked(slots, i),
    };
  });
}
