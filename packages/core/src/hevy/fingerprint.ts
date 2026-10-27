import type { WorkoutDetail } from "../dto/workout.js";

/** The fingerprint's version tag; a stored fingerprint with another tag reads `sent` (spec AC26). */
export const HEVY_FINGERPRINT_VERSION = "v1";

/**
 * Spec 19.0 AC13, §6.5: a canonical string over exactly the fields the export reads, in a fixed order, so a stored
 * fingerprint says whether the workout changed since it was sent. Arrays are sorted by position (sets by
 * `setNumber`), so the input order does not matter. Ids, timestamps other than start and end, planned sets,
 * completion and routine details are left out. The API hashes it (`node:crypto`); `@sin/core` stays pure.
 */
export function hevyFingerprintSource(detail: WorkoutDetail): string {
  const sections = [...detail.sections].sort((a, b) => a.position - b.position);
  const sectionIndex = new Map(sections.map((s, i) => [s.id, i]));
  const exercises = [...detail.exercises].sort((a, b) => a.position - b.position);
  return (
    HEVY_FINGERPRINT_VERSION +
    JSON.stringify([
      detail.title,
      detail.notes,
      detail.startedAt,
      detail.endedAt,
      detail.routineName,
      sections.map((s) => [s.name, s.notes, s.position]),
      exercises.map((e) => [
        e.position,
        e.exerciseId,
        e.notes,
        e.supersetGroup,
        e.sectionId === null ? -1 : (sectionIndex.get(e.sectionId) ?? -1),
        [...e.sets]
          .sort((a, b) => a.setNumber - b.setNumber)
          .map((s) => [s.setType, s.reps, s.weightKg, s.distanceM, s.durationS, s.calories, s.rpe]),
      ]),
    ])
  );
}
