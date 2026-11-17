import { useSyncExternalStore } from "react";

/**
 * Spec 06.7 §6.3: the workout whose Finish tap is in progress on this screen, from the enqueue until the tap has
 * navigated (or the finish was refused). While it is set, the Workouts screen keeps `ActiveSession` mounted instead of
 * the waiting card (AC26), so the tap can open the summary itself — the card is for a finish this screen didn't just tap.
 */
let tapping: string | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

export function beginFinishTap(workoutId: string): void {
  tapping = workoutId;
  notify();
}

export function endFinishTap(): void {
  if (tapping === null) return;
  tapping = null;
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The current value, outside React (ActiveSession's unmount reads it). */
export function currentFinishTap(): string | null {
  return tapping;
}

/** The workout whose Finish tap is in progress, or `null`. */
export function useFinishTap(): string | null {
  return useSyncExternalStore(subscribe, () => tapping);
}
