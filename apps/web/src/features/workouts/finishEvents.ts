/**
 * Spec 20.2 AC24: a tiny synchronous bus the finish emits to, after the caches are seeded. Hevy's auto-push listens;
 * the finish code never imports `features/hevy/`. A listener owns its errors: one that throws is swallowed here and
 * never stops the others or the finish. Since Spec 06.7 B2 the one emitter is the provider's landing effects
 * (`finishLanding.ts`, a scan pins it); the emit-once set stays as a cheap guard for a page that lives across a replay
 * (minor 634).
 */
export interface WorkoutFinishedEvent {
  workoutId: string;
}

type Listener = (e: WorkoutFinishedEvent) => void;

const listeners = new Set<Listener>();
/** Spec 06.7 AC14: workouts already emitted on this page load, so a `409` replay (or a second path) can't emit twice. */
const emitted = new Set<string>();

/** Subscribe; returns the unsubscribe. */
export function onWorkoutFinished(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWorkoutFinished(e: WorkoutFinishedEvent): void {
  if (emitted.has(e.workoutId)) return;
  emitted.add(e.workoutId);
  for (const listener of [...listeners]) {
    try {
      listener(e);
    } catch {
      // The listener's own failure; the finish has already succeeded.
    }
  }
}

/** Test-only: forgets which workouts have emitted, as a new page load would; listeners stay. */
export function __forgetEmittedForTests(): void {
  emitted.clear();
}

/** Test-only: forgets the listeners and which workouts have emitted. */
export function __resetFinishListeners(): void {
  listeners.clear();
  emitted.clear();
}
