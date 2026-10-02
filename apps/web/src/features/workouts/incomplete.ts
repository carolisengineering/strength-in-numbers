import { requiredMeasuresFor, type WorkoutDetail } from "@sin/core";

/**
 * Mirrors the server's finish rule (Spec 05.1): a `working` set with a null required measure
 * blocks Finish. `=== null`, never falsy — `reps: 0` is a legitimate failed attempt. Advisory only;
 * the server stays the authority (§6.6).
 */
export function findIncompleteWorkingSets(detail: WorkoutDetail): string[] {
  const ids: string[] = [];
  for (const exercise of detail.exercises) {
    const required = requiredMeasuresFor(exercise.modalitySnapshot);
    for (const set of exercise.sets) {
      if (set.setType === "working" && required.some((measure) => set[measure] === null)) ids.push(set.id);
    }
  }
  return ids;
}
