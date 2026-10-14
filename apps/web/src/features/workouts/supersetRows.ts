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
  /** Spec 10.3: the exercise's workout section (`null` = loose); `sectionSegments` groups by it, never by hand. */
  readonly sectionId: string | null;
}

/** One label per stretch of equal (group, section): a superset never crosses a section heading (Spec 10.3 AC10). */
function runLabels(sorted: readonly WorkoutExerciseDetail[]): (number | null)[] {
  let label = 0;
  return sorted.map((e, i) => {
    if (e.supersetGroup === null) return null;
    const prev = sorted[i - 1];
    if (!prev || prev.supersetGroup !== e.supersetGroup || prev.sectionId !== e.sectionId) label += 1;
    return label;
  });
}

/**
 * The one place the session screens derive superset display (Spec 10.1 AC17, AC24). The target line carries the
 * planned weight on every screen, through this one path and with no option (Spec 10.2 D8, AC29, AC30).
 */
export function supersetRows(exercises: readonly WorkoutExerciseDetail[]): SupersetRow[] {
  const sorted = [...exercises].sort((a, b) => a.position - b.position);
  const groups = runLabels(sorted);
  const ordinals = runOrdinals(groups);
  const slots = sorted.map((e, i) => ({ id: e.id, group: groups[i] ?? null }));
  return sorted.map((exercise, i) => {
    const ordinal = ordinals[i] ?? null;
    const line = targetLine(exercise, exercise.plannedSets);
    return {
      exercise,
      bracket: runPosition(groups, i),
      ordinal,
      line,
      label: ordinal === null ? null : itemAccessibleName(exercise.exerciseNameSnapshot, ordinal, line, false),
      linkedBelow: isLinked(slots, i),
      sectionId: exercise.sectionId,
    };
  });
}
