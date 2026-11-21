import { useEffect } from "react";
import { useLocation } from "react-router";
import type { LandedStore } from "./outbox/landedStore";

/**
 * Spec 06.7 AC27, D12 (minors 636, 668): the saved line goes once the lifter leaves the screen it was shown on. "Leaving"
 * is a route change after which the line is no longer drawn, never an unmount by itself: StrictMode's dev remount, a
 * resize across 64rem (the Workouts screen moves between the detail slot and the list pane) or a spinner branch unmount
 * it without leaving. Each drawn line counts its mounts per store, so a new store (another sign-in) starts clean.
 */
const mountsByStore = new WeakMap<LandedStore, Map<string, number>>();

function mountsOf(store: LandedStore): Map<string, number> {
  let mounts = mountsByStore.get(store);
  if (!mounts) mountsByStore.set(store, (mounts = new Map()));
  return mounts;
}

/** `LandedLine` calls this from an effect; the returned cleanup is the unmount. */
export function markLandedShown(store: LandedStore, workoutId: string): () => void {
  const mounts = mountsOf(store);
  mounts.set(workoutId, (mounts.get(workoutId) ?? 0) + 1);
  return () => mounts.set(workoutId, (mounts.get(workoutId) ?? 1) - 1);
}

/**
 * Starting a workout leaves the Start screen without a route change (the session replaces it on `/app/workouts`), so
 * the start removes every entry whose line was drawn; a discard then brings Start back without it (final review).
 */
export function leaveLanded(store: LandedStore): void {
  const mounts = mountsOf(store);
  for (const workoutId of mounts.keys()) store.remove(workoutId);
  mounts.clear();
}

/**
 * Mounted once, above every screen (`WorkoutClientProvider`). Its effect runs after the new screen's effects, so on a
 * route change a line that is still drawn (the desktop list pane beside a routine) keeps its entry, and one that left
 * with its screen is removed.
 */
export function useLandedLeave(store: LandedStore | null): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!store) return;
    const mounts = mountsOf(store);
    for (const [workoutId, count] of mounts) {
      if (count > 0) continue;
      mounts.delete(workoutId);
      store.remove(workoutId);
    }
  }, [store, pathname]);
}
