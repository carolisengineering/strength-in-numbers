/**
 * Spec 17.1 §6.6 / §6.7: what End workout early would leave out, and what the bar holds. Pure and positional:
 * a planned row is "logged" once the exercise's list (queued and failed sets included, 06.2) is that long.
 */
export interface PlannedRow {
  readonly exercise: {
    readonly id: string;
    readonly exerciseNameSnapshot: string;
    readonly plannedSets: readonly unknown[];
    readonly sets: readonly unknown[];
  };
}

export interface UnloggedPlanned {
  /** Planned sets not yet logged, across the workout. */
  readonly total: number;
  /** Planned sets in the whole workout (0 = free-form). */
  readonly planned: number;
  readonly byExercise: readonly { readonly id: string; readonly name: string; readonly count: number }[];
}

export function unloggedPlanned(rows: readonly PlannedRow[]): UnloggedPlanned {
  let total = 0;
  let planned = 0;
  const byExercise: { id: string; name: string; count: number }[] = [];
  for (const { exercise } of rows) {
    planned += exercise.plannedSets.length;
    const count = Math.max(exercise.plannedSets.length - exercise.sets.length, 0);
    if (count === 0) continue;
    total += count;
    byExercise.push({ id: exercise.id, name: exercise.exerciseNameSnapshot, count });
  }
  return { total, planned, byExercise };
}

export type BarMode = "add" | "finish" | "log";

/** AC27: "finish" exactly when the workout has a plan, none of it is left, and the current exercise has a plan. */
export function barMode(rows: readonly PlannedRow[], currentId: string | null): BarMode {
  if (rows.length === 0) return "add";
  const { total, planned } = unloggedPlanned(rows);
  const current = rows.find((r) => r.exercise.id === currentId);
  return planned > 0 && total === 0 && current !== undefined && current.exercise.plannedSets.length > 0 ? "finish" : "log";
}
