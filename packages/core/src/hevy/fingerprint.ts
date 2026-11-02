import type { SectionTimer } from "../dto/section-timer.js";
import type { WorkoutDetail, WorkoutSection } from "../dto/workout.js";

/** The fingerprint's version tag; a stored fingerprint with another tag reads `sent` (spec AC26). */
export const HEVY_FINGERPRINT_VERSION = "v1";

/**
 * Spec 19.0 AC13, §6.5: a canonical string over exactly the fields the export reads, in a fixed order, so a stored
 * fingerprint says whether the workout changed since it was sent. Arrays are sorted by position (sets by
 * `setNumber`, round times by round), so the input order does not matter. Ids, timestamps other than start and
 * end, planned sets, completion and routine details are left out. The API hashes it (`node:crypto`); `@sin/core` stays pure.
 * Spec 09.5 AC29 / D18: only a timed section's entry gains its plan, result and round times, so an untimed
 * workout's source (and every fingerprint stored before 0018) is unchanged and the tag stays `v1`.
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
      sections.map(sectionEntry),
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

/** `[format, roundSeconds, rounds, capSeconds]`, a number the variant does not have being `null` (§6.7). */
function planEntry(timer: SectionTimer): [string, number | null, number | null, number | null] {
  switch (timer.format) {
    case "set_timer":
      return [timer.format, timer.roundSeconds, timer.rounds, null];
    case "amrap":
    case "time_cap":
      return [timer.format, null, null, timer.capSeconds];
  }
}

/** Spec 19.0 §6.5's `[name, notes, position]`; Spec 09.5 §6.7 appends timed data for a timed section only. */
function sectionEntry(s: WorkoutSection): unknown[] {
  if (s.timer === null) return [s.name, s.notes, s.position];
  return [
    s.name,
    s.notes,
    s.position,
    planEntry(s.timer),
    s.result ? [s.result.rounds, s.result.reps, s.result.finishSeconds, s.result.capped] : null,
    [...s.roundTimes].sort((a, b) => a.round - b.round).map((r) => [r.round, r.seconds]),
  ];
}
