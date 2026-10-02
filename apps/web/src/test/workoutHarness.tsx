import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkoutClientContext } from "../features/workouts/queries";
import type { WorkoutClient } from "../features/workouts/workoutClient";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** A `WorkoutClient` whose every operation throws unless the test overrides it. */
export function fakeClient(overrides: Partial<WorkoutClient> = {}): WorkoutClient {
  const unexpected = (name: string) => () => Promise.reject(new Error(`unexpected WorkoutClient.${name}()`));
  return {
    getActive: unexpected("getActive"),
    getById: unexpected("getById"),
    start: unexpected("start"),
    finish: unexpected("finish"),
    deleteWorkout: unexpected("deleteWorkout"),
    addExercise: unexpected("addExercise"),
    moveExercise: unexpected("moveExercise"),
    removeExercise: unexpected("removeExercise"),
    createSet: unexpected("createSet"),
    updateSet: unexpected("updateSet"),
    deleteSet: unexpected("deleteSet"),
    ...overrides,
  } as WorkoutClient;
}

/** A hook/component wrapper: a QueryClient plus an injected `WorkoutClient`. */
export function wrapperWith(queryClient: QueryClient, client: WorkoutClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <WorkoutClientContext.Provider value={client}>{children}</WorkoutClientContext.Provider>
      </QueryClientProvider>
    );
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
