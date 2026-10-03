import {
  useIsMutating,
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  CreateSet,
  CreateWorkout,
  Modality,
  SetEntry,
  UpdateSet,
  Workout,
  WorkoutDetail,
  WorkoutExercise,
} from "@sin/core";
import { ApiError } from "../../api";
import { track } from "../../observability/track";
import { withSetRemoved, withSetUpserted } from "./cache";
import { WORKOUT_KEYS, useWorkoutClient } from "./queries";

/**
 * Cache writes live in the hook-level `onSuccess`, never in a `mutate(vars, { onSuccess })` call:
 * TanStack skips call-level callbacks when the calling component unmounted before the response, but
 * runs hook-level ones. So a lifter who switches tabs mid-request still gets a correct cache (AC12).
 * Navigation stays at the call site for the opposite reason.
 */

/** Every set write carries this key so Finish can wait for them (Review Focus #4). */
export const SET_MUTATION_KEY = ["workouts", "set"] as const;

export function useIsSetWritePending(): boolean {
  return useIsMutating({ mutationKey: SET_MUTATION_KEY }) > 0;
}

/**
 * Before a set write, cancel any in-flight read of the active workout so a stale response cannot land
 * on top of the write and erase it (§6.2, AC11). Remember whether one was actually interrupted: it
 * may have been the follow-up refetch of an add / move / remove, which `refetchQueries` swallows the
 * cancellation of — the new card would then never appear until the next focus.
 */
async function cancelActiveReads(queryClient: QueryClient): Promise<{ interrupted: boolean }> {
  const interrupted = queryClient.isFetching({ queryKey: WORKOUT_KEYS.active }) > 0;
  await queryClient.cancelQueries({ queryKey: WORKOUT_KEYS.active });
  return { interrupted };
}

/** Re-read once the set write has landed, if it interrupted a read. Not awaited: logging must not wait. */
function refetchIfInterrupted(queryClient: QueryClient, context: { interrupted: boolean } | undefined): void {
  if (context?.interrupted) void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
}

const isNotFound = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

/** A repeat of an already-applied delete answers 404; the screen treats that as success. */
async function ignoreNotFound(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

// ---- workout lifecycle ---------------------------------------------------------------------------

export function useStartWorkout(): UseMutationResult<Workout, Error, { body: CreateWorkout }> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body }) => client.start(body),
    // `start` returns a Workout, not a WorkoutDetail, and a 200 replay may already have exercises:
    // refetch rather than seed. Returning the promise keeps the mutation pending until it lands.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active }),
  });
}

export function useFinishWorkout(): UseMutationResult<
  Workout,
  Error,
  { id: string; endedAt: string; viaReplay?: boolean }
> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, endedAt }) => client.finish(id, { endedAt }),
    onSuccess: (workout, { id, viaReplay }) => {
      const cached = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
      queryClient.removeQueries({ queryKey: WORKOUT_KEYS.active });
      if (cached) queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id), { ...cached, ...workout });
      track("workout_finished", {
        exerciseCount: cached?.exercises.length ?? 0,
        setCount: cached?.exercises.reduce((n, e) => n + e.sets.length, 0) ?? 0,
        durationMin: Math.round((Date.parse(workout.endedAt ?? workout.startedAt) - Date.parse(workout.startedAt)) / 60_000),
        ...(viaReplay ? { viaReplay: true } : {}),
      });
    },
  });
}

export function useDeleteWorkout(): UseMutationResult<
  void,
  Error,
  { id: string; phase: "active" | "finished"; setCount: number }
> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => ignoreNotFound(() => client.deleteWorkout(id)),
    onSuccess: (_void, { id, phase, setCount }) => {
      queryClient.removeQueries({ queryKey: WORKOUT_KEYS.detail(id) });
      track("workout_discarded", { phase, setCount });
      return queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    },
  });
}

// ---- exercise structure: the response is one row but siblings' positions shift, so refetch -------
// (the returned promise keeps `isPending` true until the refetch settles, which serialises these)

export function useAddExercise(): UseMutationResult<
  WorkoutExercise,
  Error,
  { workoutId: string; exerciseId: string; modality: Modality }
> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workoutId, exerciseId }) => client.addExercise(workoutId, { exerciseId }),
    onSuccess: (_row, { modality }) => {
      track("exercise_added", { modality });
      return queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    },
  });
}

export function useMoveExercise(): UseMutationResult<
  WorkoutExercise,
  Error,
  { id: string; position: number; direction: "up" | "down" }
> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, position }) => client.moveExercise(id, position),
    onSuccess: (_row, { direction }) => {
      track("exercise_moved", { direction });
      return queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    },
  });
}

export function useRemoveExercise(): UseMutationResult<void, Error, { id: string; setCount: number }> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => ignoreNotFound(() => client.removeExercise(id)),
    onSuccess: (_void, { setCount }) => {
      track("exercise_removed", { setCount });
      return queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    },
  });
}

// ---- sets: the response is the whole truth for that row, so write it into the cache --------------

export interface CreateSetVars {
  workoutExerciseId: string;
  body: CreateSet;
  modality: Modality;
  msToLog: number;
  edited: boolean;
}

export function useCreateSet(): UseMutationResult<SetEntry, Error, CreateSetVars> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_MUTATION_KEY,
    mutationFn: ({ workoutExerciseId, body }) => client.createSet(workoutExerciseId, body),
    // Stop an in-flight refetch landing on top of the write and erasing it (§6.2, AC11).
    onMutate: () => cancelActiveReads(queryClient),
    onSettled: (_data, _error, _variables, context) => refetchIfInterrupted(queryClient, context),
    onSuccess: (set, { modality, msToLog, edited }) => {
      queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => (d ? withSetUpserted(d, set) : d));
      track("set_logged", { modality, setType: set.setType, edited, msToLog });
    },
  });
}

export function useUpdateSet(): UseMutationResult<
  SetEntry,
  Error,
  { id: string; body: UpdateSet; modality: Modality }
> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_MUTATION_KEY,
    mutationFn: ({ id, body }) => client.updateSet(id, body),
    onMutate: () => cancelActiveReads(queryClient),
    onSettled: (_data, _error, _variables, context) => refetchIfInterrupted(queryClient, context),
    onSuccess: (set, { modality }) => {
      queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => (d ? withSetUpserted(d, set) : d));
      track("set_edited", { modality });
    },
  });
}

export function useDeleteSet(): UseMutationResult<void, Error, { id: string; modality: Modality }> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_MUTATION_KEY,
    mutationFn: ({ id }) => ignoreNotFound(() => client.deleteSet(id)),
    onMutate: () => cancelActiveReads(queryClient),
    onSettled: (_data, _error, _variables, context) => refetchIfInterrupted(queryClient, context),
    onSuccess: (_void, { id, modality }) => {
      queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => (d ? withSetRemoved(d, id) : d));
      track("set_deleted", { modality });
    },
  });
}
