import { useIsMutating, useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { CreateSet, SetEntry, UpdateSet, UpdatedWorkout, WorkoutDetail, WorkoutExercise } from "@sin/core";
import { ApiError } from "../../../api";
import { track } from "../../../observability/track";
import { applyEditedCaches } from "../../records/cache";
import { withExerciseNotes, withSetRemoved, withSetUpserted } from "../cache";
import { WORKOUT_KEYS, useEditWorkoutClient } from "../queries";
import type { WorkoutUpdate } from "../workoutClient";
import { mergeWorkout } from "./editCache";

/**
 * Spec 18.0's edit-mode writes (§6.2, D5): pessimistic, online-only, on the plain REST client.
 *
 * - `networkMode: "always"`: offline fails at once, so the sheet can say so.
 * - Cache writes live only in the hook-level `onSuccess` — TanStack still runs it after the screen
 *   unmounts (Done tapped mid-request), and a failed write leaves the cache exactly as it was (AC14).
 * - Never retried automatically; the lifter's own Save / Try again is the retry (AC17).
 * - Their own key, so a pending edit never disables a live Finish (`SET_MUTATION_KEY` is the live one).
 */
export const EDIT_MUTATION_KEY = ["workouts", "edit"] as const;

export function useIsEditWritePending(): boolean {
  return useIsMutating({ mutationKey: EDIT_MUTATION_KEY }) > 0;
}

/** The server's enum for `workout_edited` (Spec 07.4 §9); emitted as `workout_edit { edit }` (AC27). */
export type EditKind =
  | "set_added"
  | "set_changed"
  | "set_deleted"
  | "exercise_added"
  | "exercise_removed"
  | "exercise_moved"
  | "exercise_regrouped"
  | "exercise_noted"
  | "details_changed"
  // Spec 10.6 AC19 (the server's names, Spec 09.4 §9)
  | "section_added"
  | "section_changed"
  | "section_removed"
  | "exercise_sectioned";

/** One successful edit: one scalar event, then the History / Progress / records refresh (AC22, AC27). */
export function editSucceeded(queryClient: QueryClient, edit: EditKind): void {
  track("workout_edit", { edit });
  applyEditedCaches(queryClient);
}

/**
 * Before a set write, cancel an in-flight read of the detail so a stale response cannot land on top of
 * the write and erase it; re-read once afterwards if one was interrupted (the live `cancelActiveReads`).
 */
export async function cancelDetailReads(queryClient: QueryClient, workoutId: string): Promise<{ interrupted: boolean }> {
  const key = WORKOUT_KEYS.detail(workoutId);
  const interrupted = queryClient.isFetching({ queryKey: key }) > 0;
  await queryClient.cancelQueries({ queryKey: key });
  return { interrupted };
}

export function refetchIfInterrupted(queryClient: QueryClient, workoutId: string, context: { interrupted: boolean } | undefined): void {
  if (context?.interrupted) void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.detail(workoutId) });
}

export function writeDetail(queryClient: QueryClient, workoutId: string, change: (d: WorkoutDetail) => WorkoutDetail): void {
  queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workoutId), (d) => (d ? change(d) : d));
}

/** A repeated delete answers 404: it already happened. */
export async function ignoreNotFound(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

export function useEditCreateSet(): UseMutationResult<
  SetEntry,
  Error,
  { workoutId: string; workoutExerciseId: string; body: CreateSet }
> {
  const client = useEditWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: EDIT_MUTATION_KEY,
    networkMode: "always",
    retry: false,
    mutationFn: ({ workoutExerciseId, body }) => client.createSet(workoutExerciseId, body),
    onMutate: ({ workoutId }) => cancelDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, context) => refetchIfInterrupted(queryClient, workoutId, context),
    onSuccess: (set, { workoutId }) => {
      writeDetail(queryClient, workoutId, (d) => withSetUpserted(d, set));
      editSucceeded(queryClient, "set_added");
    },
  });
}

export function useEditUpdateSet(): UseMutationResult<SetEntry, Error, { workoutId: string; id: string; body: UpdateSet }> {
  const client = useEditWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: EDIT_MUTATION_KEY,
    networkMode: "always",
    retry: false,
    mutationFn: ({ id, body }) => client.updateSet(id, body),
    onMutate: ({ workoutId }) => cancelDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, context) => refetchIfInterrupted(queryClient, workoutId, context),
    onSuccess: (set, { workoutId }) => {
      writeDetail(queryClient, workoutId, (d) => withSetUpserted(d, set));
      editSucceeded(queryClient, "set_changed");
    },
  });
}

export function useEditDeleteSet(): UseMutationResult<void, Error, { workoutId: string; id: string }> {
  const client = useEditWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: EDIT_MUTATION_KEY,
    networkMode: "always",
    retry: false,
    mutationFn: ({ id }) => ignoreNotFound(() => client.deleteSet(id)),
    onMutate: ({ workoutId }) => cancelDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, context) => refetchIfInterrupted(queryClient, workoutId, context),
    onSuccess: (_void, { workoutId, id }) => {
      writeDetail(queryClient, workoutId, (d) => withSetRemoved(d, id));
      editSucceeded(queryClient, "set_deleted");
    },
  });
}

/** Spec 18.0 AC12: an exercise note that waits for the server (live notes go through the outbox instead). */
export function useEditSetNote(): UseMutationResult<WorkoutExercise, Error, { workoutId: string; id: string; notes: string | null }> {
  const client = useEditWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: EDIT_MUTATION_KEY,
    networkMode: "always",
    retry: false,
    mutationFn: ({ id, notes }) => client.setExerciseNote(id, notes),
    // Final review #2: as for the set writes, a read in flight must not land on top of the saved note.
    onMutate: ({ workoutId }) => cancelDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, context) => refetchIfInterrupted(queryClient, workoutId, context),
    onSuccess: (exercise, { workoutId }) => {
      writeDetail(queryClient, workoutId, (d) => withExerciseNotes(d, exercise));
      editSucceeded(queryClient, "exercise_noted");
    },
  });
}

/** Spec 18.0 AC54: the workout's title and notes; the response's fields are merged into the detail. */
export function useEditDetails(): UseMutationResult<UpdatedWorkout, Error, { workoutId: string; body: WorkoutUpdate }> {
  const client = useEditWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: EDIT_MUTATION_KEY,
    networkMode: "always",
    retry: false,
    mutationFn: ({ workoutId, body }) => client.updateWorkout(workoutId, body),
    onMutate: ({ workoutId }) => cancelDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, context) => refetchIfInterrupted(queryClient, workoutId, context),
    onSuccess: (updated, { workoutId }) => {
      writeDetail(queryClient, workoutId, (d) => mergeWorkout(d, updated));
      editSucceeded(queryClient, "details_changed");
    },
  });
}

// ---- exercise structure: siblings' positions shift, so re-read; the returned promise keeps `isPending` until it lands

export function useEditAddExercise(): UseMutationResult<WorkoutExercise, Error, { workoutId: string; exerciseId: string }> {
  const client = useEditWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    retry: false,
    mutationFn: ({ workoutId, exerciseId }) => client.addExercise(workoutId, { exerciseId }),
    onSuccess: (_row, { workoutId }) => {
      editSucceeded(queryClient, "exercise_added");
      return queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.detail(workoutId) });
    },
  });
}

export function useEditRemoveExercise(): UseMutationResult<void, Error, { workoutId: string; id: string }> {
  const client = useEditWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    retry: false,
    mutationFn: ({ id }) => ignoreNotFound(() => client.removeExercise(id)),
    onSuccess: (_void, { workoutId }) => {
      editSucceeded(queryClient, "exercise_removed");
      return queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.detail(workoutId) });
    },
  });
}
