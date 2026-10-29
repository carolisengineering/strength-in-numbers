import { useIsMutating, useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { CreateSet, SetEntry, UpdateSet, UpdatedWorkout, WorkoutDetail, WorkoutExercise } from "@sin/core";
import { ignoreNotFound } from "../errors";
import { track } from "../../../observability/track";
import { applyEditedCaches } from "../../records/cache";
import { withExerciseNotes, withSetRemoved, withSetUpserted } from "../cache";
import { WORKOUT_KEYS, useEditWorkoutClient } from "../queries";
import type { WorkoutUpdate } from "../workoutClient";
import { guardReads, rereadIfStale, type ReadGuard } from "../readGuard";
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
 * Before a write that patches the detail from its response: cancel a read in flight, and watch for one that starts
 * while the write is pending (a focus refetch); either may answer from before the commit, so the detail is read
 * once more when the write settles (#154; the live hooks do the same for the active workout).
 */
export function guardDetailReads(queryClient: QueryClient, workoutId: string): Promise<ReadGuard> {
  return guardReads(queryClient, WORKOUT_KEYS.detail(workoutId));
}

export function rereadDetailIfStale(queryClient: QueryClient, workoutId: string, guard: ReadGuard | undefined): void {
  rereadIfStale(queryClient, WORKOUT_KEYS.detail(workoutId), guard);
}

export function writeDetail(queryClient: QueryClient, workoutId: string, change: (d: WorkoutDetail) => WorkoutDetail): void {
  queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workoutId), (d) => (d ? change(d) : d));
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
    onMutate: ({ workoutId }) => guardDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, guard) => rereadDetailIfStale(queryClient, workoutId, guard),
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
    onMutate: ({ workoutId }) => guardDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, guard) => rereadDetailIfStale(queryClient, workoutId, guard),
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
    onMutate: ({ workoutId }) => guardDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, guard) => rereadDetailIfStale(queryClient, workoutId, guard),
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
    onMutate: ({ workoutId }) => guardDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, guard) => rereadDetailIfStale(queryClient, workoutId, guard),
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
    onMutate: ({ workoutId }) => guardDetailReads(queryClient, workoutId),
    onSettled: (_data, _error, { workoutId }, guard) => rereadDetailIfStale(queryClient, workoutId, guard),
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
