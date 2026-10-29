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
  UpdatedWorkout,
  Workout,
  WorkoutDetail,
  WorkoutExercise,
} from "@sin/core";
import { ignoreNotFound } from "./errors";
import { track } from "../../observability/track";
import { applyDeletedCaches, applyFinishedCaches } from "../records/cache";
import { useDraftStores } from "./drafts/DraftStoreContext";
import { useOutbox } from "./outbox/OutboxContext";
import { useRestStores } from "./useRestTimer";
import { withExerciseNotes, withSetRemoved, withSetUpserted } from "./cache";
import { WORKOUT_KEYS, useWorkoutClient } from "./queries";
import { guardReads, rereadIfStale, type ReadGuard } from "./readGuard";
import { reportUnexpected } from "./reportUnexpected";
import type { WorkoutClient, WorkoutExercisePatch } from "./workoutClient";

/**
 * Cache writes live in the hook-level `onSuccess`, never in a `mutate(vars, { onSuccess })` call:
 * TanStack skips call-level callbacks when the calling component unmounted before the response, but
 * runs hook-level ones. So a lifter who switches tabs mid-request still gets a correct cache (AC12).
 * Navigation stays at the call site for the opposite reason.
 *
 * Every mutation here uses `networkMode: "always"` (Spec 06.2 D5): TanStack's default pauses a
 * mutation while the browser reports offline. Set writes must reach the outbox at once; every other
 * write must fail at once, so the screen can say "You're offline" instead of hanging.
 */

/** Every set write carries this key: Finish stays disabled while any set write is in flight. */
export const SET_MUTATION_KEY = ["workouts", "set"] as const;

export function useIsSetWritePending(): boolean {
  return useIsMutating({ mutationKey: SET_MUTATION_KEY }) > 0;
}

/**
 * Before a set write, cancel any in-flight read of the active workout so a stale response cannot land on top of the
 * write and erase it (§6.2, AC11), and watch for a read that starts while it is pending (#154). Either is re-read
 * once the write settles: an interrupted one may have been the follow-up refetch of an add / move / remove, which
 * `refetchQueries` swallows the cancellation of — the new card would then never appear until the next focus.
 * Not awaited: logging must not wait.
 */
const guardActiveReads = (queryClient: QueryClient): Promise<ReadGuard> => guardReads(queryClient, WORKOUT_KEYS.active);
const rereadActiveIfStale = (queryClient: QueryClient, guard: ReadGuard | undefined): void =>
  rereadIfStale(queryClient, WORKOUT_KEYS.active, guard);

// ---- workout lifecycle ---------------------------------------------------------------------------

export function useStartWorkout(): UseMutationResult<Workout, Error, { body: CreateWorkout }> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: ({ body }) => client.start(body),
    // `start` returns a Workout, not a WorkoutDetail, and a 200 replay may already have exercises:
    // refetch rather than seed. Returning the promise keeps the mutation pending until it lands.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active }),
  });
}

export function useFinishWorkout(): UseMutationResult<
  UpdatedWorkout,
  Error,
  { id: string; endedAt: string; viaReplay?: boolean; endedEarly?: boolean; unloggedPlannedSets?: number; keepRoutine?: boolean }
> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  const drafts = useDraftStores();
  const rest = useRestStores();
  return useMutation({
    networkMode: "always",
    // Spec 10.5 AC13: `keepRoutine` goes on the wire only as `true`; otherwise the body is exactly `{ endedAt }`.
    mutationFn: ({ id, endedAt, keepRoutine }) => client.finish(id, keepRoutine ? { endedAt, keepRoutine: true } : { endedAt }),
    // Seed the summary only. Removing the active entry here would leave the Workouts screen's observer
    // pointing at nothing until the route changes, and any re-render in that gap rebuilds it as a
    // pending query (spinner + refetch). `FinishedWorkoutScreen` removes it once mounted (Spec 06.4 D1),
    // or `ActiveSession` does when the response lands after the lifter left (no summary will mount).
    onSuccess: (updated, { id, viaReplay, endedEarly, unloggedPlannedSets }) => {
      drafts?.clearWorkout(id); // Spec 06.5 AC10
      rest?.clearWorkout(id); // Spec 17.1 AC47
      // `newRecords` belongs to the records cache, never to the workout detail (Spec 08.0 AC5).
      const { newRecords, ...workout } = updated;
      const cached = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
      if (cached) queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id), { ...cached, ...workout });
      applyFinishedCaches(queryClient, id, newRecords);
      track("workout_finished", {
        exerciseCount: cached?.exercises.length ?? 0,
        setCount: cached?.exercises.reduce((n, e) => n + e.sets.length, 0) ?? 0,
        durationMin: Math.round((Date.parse(workout.endedAt ?? workout.startedAt) - Date.parse(workout.startedAt)) / 60_000),
        // Spec 17.1 AC53: scalars only.
        endedEarly: endedEarly ?? false,
        unloggedPlannedSets: unloggedPlannedSets ?? 0,
        // Spec 18.0 AC43: the cached entry is still the pre-finish one (this hook only seeds the summary).
        hadPlannedDuration: cached?.plannedDurationSeconds != null,
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
  const drafts = useDraftStores();
  const rest = useRestStores();
  const outbox = useOutbox();
  return useMutation({
    networkMode: "always",
    mutationFn: ({ id }) => ignoreNotFound(() => client.deleteWorkout(id)),
    onSuccess: (_void, { id, phase, setCount }) => {
      drafts?.clearWorkout(id); // Spec 06.5 AC10
      rest?.clearWorkout(id); // Spec 17.1 AC47
      outbox?.dropWorkout(id); // Spec 18.0 AC25: an op for a workout the lifter just deleted must not be sent
      queryClient.removeQueries({ queryKey: WORKOUT_KEYS.detail(id) });
      // An in-progress workout has no records and no History row (Spec 08.0 AC8).
      if (phase === "finished") applyDeletedCaches(queryClient, id);
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
    networkMode: "always",
    mutationFn: ({ workoutId, exerciseId }) => client.addExercise(workoutId, { exerciseId }),
    onSuccess: (_row, { modality }) => {
      track("exercise_added", { modality });
      return queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    },
  });
}

/**
 * One `PATCH /v1/workout-exercises/{id}` (Spec 10.1 AC12). Side-effect free: `useRegroup` sequences, refetches and tracks.
 * Spec 18.0: the edit screen passes its plain REST client; live callers pass nothing.
 */
export function useUpdateWorkoutExercise(override?: WorkoutClient): UseMutationResult<WorkoutExercise, Error, { id: string; body: WorkoutExercisePatch }> {
  const live = useWorkoutClient();
  const client = override ?? live;
  return useMutation({
    networkMode: "always",
    mutationFn: ({ id, body }) => client.updateWorkoutExercise(id, body),
  });
}

export function useRemoveExercise(): UseMutationResult<void, Error, { id: string; setCount: number }> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
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
    networkMode: "always",
    mutationFn: ({ workoutExerciseId, body }) => client.createSet(workoutExerciseId, body),
    // Stop an in-flight refetch landing on top of the write and erasing it (§6.2, AC11).
    onMutate: () => guardActiveReads(queryClient),
    onSettled: (_data, _error, _variables, guard) => rereadActiveIfStale(queryClient, guard),
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
    networkMode: "always",
    mutationFn: ({ id, body }) => client.updateSet(id, body),
    onMutate: () => guardActiveReads(queryClient),
    onSettled: (_data, _error, _variables, guard) => rereadActiveIfStale(queryClient, guard),
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
    networkMode: "always",
    mutationFn: ({ id }) => ignoreNotFound(() => client.deleteSet(id)),
    onMutate: () => guardActiveReads(queryClient),
    onSettled: (_data, _error, _variables, guard) => rereadActiveIfStale(queryClient, guard),
    onSuccess: (_void, { id, modality }) => {
      queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => (d ? withSetRemoved(d, id) : d));
      track("set_deleted", { modality });
    },
  });
}

/**
 * A note edit (Spec 10.3 AC28). With the queued client it resolves at once with the projected exercise; the
 * outbox owns delivery and the pending / failed marks, so this hook only writes the optimistic text into the cache
 * and never gates Finish (the outbox count does).
 */
export function useSetExerciseNote(): UseMutationResult<WorkoutExercise, Error, { id: string; notes: string | null }> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: ({ id, notes }) => client.setExerciseNote(id, notes),
    onMutate: () => guardActiveReads(queryClient),
    onSettled: (_data, _error, _variables, guard) => rereadActiveIfStale(queryClient, guard),
    onSuccess: (exercise) => {
      queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => (d ? withExerciseNotes(d, exercise) : d));
    },
    onError: (error) => reportUnexpected("update-note", error),
  });
}
