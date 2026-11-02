import type { WorkoutDetail } from "@sin/core";

/**
 * Frozen at Spec 19.0 for 09.5 AC29(d). Never edit; the point is that it does not follow the code.
 * A verbatim copy of `hevyFingerprintSource` (packages/core/src/hevy/fingerprint.ts) before Spec 09.5 Phase C,
 * so a test can store the fingerprint a pre-`0018` send would have stored and check it still reads `sent`.
 */
export function legacyHevyFingerprintSourceV1(detail: WorkoutDetail): string {
  const sections = [...detail.sections].sort((a, b) => a.position - b.position);
  const sectionIndex = new Map(sections.map((s, i) => [s.id, i]));
  const exercises = [...detail.exercises].sort((a, b) => a.position - b.position);
  return (
    "v1" +
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
