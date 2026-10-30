/**
 * Spec 20.2 AC24: a tiny synchronous bus that both finish paths (`useFinishWorkout`'s `onSuccess` and
 * `ActiveSession`'s `409 workout-finished` recovery) emit to, after the caches are seeded. Hevy's auto-push listens;
 * the finish code never imports `features/hevy/`. A listener owns its errors: one that throws is swallowed here and
 * never stops the others or the finish.
 */
export interface WorkoutFinishedEvent {
  workoutId: string;
}

type Listener = (e: WorkoutFinishedEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe. */
export function onWorkoutFinished(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWorkoutFinished(e: WorkoutFinishedEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(e);
    } catch {
      // The listener's own failure; the finish has already succeeded.
    }
  }
}

/** Test-only. */
export function __resetFinishListeners(): void {
  listeners.clear();
}
