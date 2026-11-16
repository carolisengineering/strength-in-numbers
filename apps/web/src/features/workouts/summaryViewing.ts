import { useEffect } from "react";

/** How many mounted summaries show each workout (two can overlap for a moment during a route change). */
const open = new Map<string, number>();

/**
 * Spec 06.7 AC27, §6.2: whether the summary of `workoutId` is on screen. The provider reads it when a finish lands:
 * an open summary updates in place (AC25), so no one-time "saved" line is stored.
 */
export function viewing(workoutId: string): boolean {
  return (open.get(workoutId) ?? 0) > 0;
}

/** Registers the mounted summary of `workoutId` (`FinishedWorkoutScreen`, from Phase B2). */
export function useViewingSummary(workoutId: string): void {
  useEffect(() => {
    open.set(workoutId, (open.get(workoutId) ?? 0) + 1);
    return () => {
      const left = (open.get(workoutId) ?? 1) - 1;
      if (left > 0) open.set(workoutId, left);
      else open.delete(workoutId);
    };
  }, [workoutId]);
}
