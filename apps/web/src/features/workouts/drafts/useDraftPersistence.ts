import { useCallback, useEffect, useState } from "react";
import type { SetDraft } from "../setDraft";
import type { DraftFields } from "./draftStore";
import { useDraftStores } from "./DraftStoreContext";

/** The stored draft for this exercise, read once at mount (Spec 06.5 §6.2): `EntryRow` needs it before its reducer initializer runs. */
export function useRestoredDraft(workoutId: string, workoutExerciseId: string): DraftFields | undefined {
  const stores = useDraftStores();
  const [restored] = useState(() => stores?.forWorkout(workoutId).get(workoutExerciseId));
  return restored;
}

export interface DraftPersistenceInput {
  workoutId: string;
  workoutExerciseId: string;
  draft: SetDraft;
  /** True until the lifter edits: an untouched row is a pure function of the plan and last set and is never stored (D2). */
  untouched: boolean;
}

/** Persist an edited draft, flush when the page is hidden or left, and expose `clear()` for a log (Spec 06.5 §6.2). */
export function useDraftPersistence({ workoutId, workoutExerciseId, draft, untouched }: DraftPersistenceInput): { clear: () => void } {
  const stores = useDraftStores();
  const store = stores ? stores.forWorkout(workoutId) : null;
  const { weight, reps, distance, minutes, seconds, rpe, calories, weightUnit, distanceUnit, setType } = draft;

  useEffect(() => {
    if (!store || untouched) return;
    store.set(workoutExerciseId, { weight, reps, distance, minutes, seconds, rpe, calories, weightUnit, distanceUnit, setType });
  }, [store, workoutExerciseId, untouched, weight, reps, distance, minutes, seconds, rpe, calories, weightUnit, distanceUnit, setType]);

  useEffect(() => {
    if (!store) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") store.flush();
    };
    const onPageHide = () => store.flush();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      store.flush();
    };
  }, [store]);

  const clear = useCallback(() => store?.clearExercise(workoutExerciseId), [store, workoutExerciseId]);
  return { clear };
}
