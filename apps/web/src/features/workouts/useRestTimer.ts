import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

import type { RestStore, RestStores } from "./restStore";
import type { RestTimer } from "./restTimer";

/** Supplied by `WorkoutClientProvider`; `null` where none is mounted (a bare component test), and then nothing rests. */
export const RestStoresContext = createContext<RestStores | null>(null);

export function useRestStores(): RestStores | null {
  return useContext(RestStoresContext);
}

/** The workout's store, for writers (`ActiveSession`). Does not subscribe, so starting a rest does not re-render the caller. */
export function useRestStore(workoutId: string): RestStore | null {
  const stores = useRestStores();
  return useMemo(() => stores?.forWorkout(workoutId) ?? null, [stores, workoutId]);
}

const noSubscribe = () => () => {};
const noTimer = () => null;

/** For the readers (`RestReadout`, `RestLine`): the current timer, re-rendering only the caller when it changes. */
export function useRestTimer(workoutId: string): { timer: RestTimer | null; now: () => number } {
  const store = useRestStore(workoutId);
  const timer = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.get ?? noTimer);
  return { timer, now: store?.now ?? Date.now };
}
