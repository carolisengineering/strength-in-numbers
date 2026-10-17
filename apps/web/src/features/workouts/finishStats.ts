import { sumVolumeMilli } from "@sin/core";

interface StatsSet {
  readonly setType: string;
  readonly reps: number | null;
  readonly weightKg: number | null;
}
interface StatsExercise {
  readonly modalitySnapshot: string;
  readonly sets: readonly StatsSet[];
}

export interface FinishStatsValue {
  readonly minutes: number;
  readonly exercises: number;
  readonly sets: number;
  /** `null` when no working set qualifies: the volume stat is then omitted, never shown as 0. */
  readonly volumeKg: number | null;
}

/**
 * Spec 17.2 AC4-AC6, AC9: the numbers the Finish dialogs and the summary header show. Pure and shared, so the dialog and
 * the header cannot disagree. Sets are logged *working* sets only (D14), matching History's `workingSetCount`.
 */
export function workingSetCount(exercises: readonly { readonly sets: readonly { readonly setType: string }[] }[]): number {
  return exercises.reduce((n, e) => n + e.sets.filter((s) => s.setType === "working").length, 0);
}

/** Whole minutes, half up, never negative (a device clock behind `startedAt`). */
export function workoutMinutes(startedAt: string, endedAt: string): number {
  return Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000));
}

export function formatMinutes(n: number): string {
  if (n < 1) return "Under 1 min";
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** kg × reps over working sets, through the one core function History's `totalVolume` uses (eligibility is its business). */
export function workoutVolumeKg(exercises: readonly StatsExercise[]): number | null {
  const milli = sumVolumeMilli(
    exercises.flatMap((e) =>
      e.sets
        .filter((s) => s.setType === "working")
        .map((s) => ({ modality: e.modalitySnapshot, weightKgMilli: s.weightKg === null ? null : Math.round(s.weightKg * 1000), reps: s.reps })),
    ),
  );
  return milli === null ? null : milli / 1000;
}

export function finishStatsFor(workout: { readonly startedAt: string; readonly exercises: readonly StatsExercise[] }, endedAt: string): FinishStatsValue {
  return {
    minutes: workoutMinutes(workout.startedAt, endedAt),
    exercises: workout.exercises.length,
    sets: workingSetCount(workout.exercises),
    volumeKg: workoutVolumeKg(workout.exercises),
  };
}
