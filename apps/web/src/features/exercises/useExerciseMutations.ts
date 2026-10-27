import type { Exercise, UpdateExercise } from "@sin/core";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { track } from "../../observability/track";
import { useCatalogStore } from "../catalog/CatalogProvider";
import { PROGRESS_KEYS } from "../progress/queries";
import { RECORDS_KEYS } from "../records/queries";
import { reportUnexpected, type ReportOp } from "../workouts/reportUnexpected";
import { classifyExerciseError } from "./exerciseErrors";
import { EXERCISE_KEYS } from "./keys";

/**
 * The one place these writes touch the query cache (Spec 18.2 §6.4, D9): a rename changes the names the Records
 * list and the series screens show; a delete drops its routines read.
 */
export function applyExerciseCaches(queryClient: QueryClient, opts: { deletedId?: string }): void {
  void queryClient.invalidateQueries({ queryKey: RECORDS_KEYS.all });
  void queryClient.invalidateQueries({ queryKey: PROGRESS_KEYS.all });
  if (opts.deletedId !== undefined) queryClient.removeQueries({ queryKey: EXERCISE_KEYS.routines(opts.deletedId) });
}

const reportIfUnknown = (op: ReportOp) => (error: unknown) => {
  if (classifyExerciseError(error) === "unknown") reportUnexpected(op, error);
};

/*
 * Spec 18.2 AC33: online-only (D7) and never retried. `onSuccess` lives in the hook's options, so it still runs if
 * the sheet or dialog that started the write is gone; navigation stays with the caller.
 */

export function useUpdateExercise() {
  const store = useCatalogStore();
  const queryClient = useQueryClient();
  return useMutation<Exercise, unknown, { id: string; patch: UpdateExercise }>({
    mutationFn: ({ id, patch }) => store.updateCustom(id, patch),
    networkMode: "always",
    retry: false,
    onSuccess: () => applyExerciseCaches(queryClient, {}),
    onError: reportIfUnknown("update-exercise"),
  });
}

export function useForkExercise() {
  const store = useCatalogStore();
  const queryClient = useQueryClient();
  return useMutation<Exercise, unknown, { id: string }>({
    mutationFn: ({ id }) => store.forkExercise(id),
    networkMode: "always",
    retry: false,
    onSuccess: () => applyExerciseCaches(queryClient, {}),
    onError: reportIfUnknown("fork-exercise"),
  });
}

export function useDeleteExercise() {
  const store = useCatalogStore();
  const queryClient = useQueryClient();
  return useMutation<void, unknown, { id: string; routineCount: number }>({
    // A 404 is "already gone": success (AC50); the refresh drops the row if this store still holds it.
    mutationFn: async ({ id }) => {
      try {
        await store.deleteCustom(id);
      } catch (error) {
        if (classifyExerciseError(error) !== "gone" || (error as { status?: number }).status !== 404) throw error;
        void store.refresh(true);
      }
    },
    networkMode: "always",
    retry: false,
    onSuccess: (_data, { id, routineCount }) => {
      track("custom_exercise_deleted", { routineCount });
      applyExerciseCaches(queryClient, { deletedId: id });
    },
    onError: reportIfUnknown("delete-exercise"),
  });
}
