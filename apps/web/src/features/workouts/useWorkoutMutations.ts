import { useCallback } from "react";
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
import { ignoreNotFound } from "../../api";
import { track } from "../../observability/track";
import { applyDeletedCaches } from "../records/cache";
import { useDraftStores } from "./drafts/DraftStoreContext";
import { useOutbox } from "./outbox/OutboxContext";
import { waitingFinishOf, withQueuedFinish } from "./outbox/finish";
import { isFinishOp, type FinishMeta, type OutboxOp } from "./outbox/ops";
import type { RestStores } from "./restStore";
import { useRestStores } from "./useRestTimer";
import { withExerciseNotes, withSetRemoved, withSetUpserted } from "./cache";
import { WORKOUT_KEYS, useWorkoutClient } from "./queries";
import { guardReads, rereadIfStale, type ReadGuard, rereadUntilLanded } from "./readGuard";
import { reportUnexpected } from "./reportUnexpected";
import type { FinishOutcome, WorkoutClient, WorkoutExercisePatch } from "./workoutClient";

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
  FinishOutcome,
  Error,
  { id: string; endedAt: string; keepRoutine?: boolean; meta: FinishMeta }
> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  const outbox = useOutbox();
  const rest = useRestStores();
  return useMutation({
    networkMode: "always",
    // Spec 10.5 AC13: `keepRoutine` goes on the wire only as `true`; otherwise the body is exactly `{ endedAt }`.
    // Spec 06.7 AC13: the finish goes through the outbox and always resolves (landed, queued or refused).
    mutationFn: ({ id, endedAt, keepRoutine, meta }) => client.finishOrQueue(id, keepRoutine ? { endedAt, keepRoutine: true } : { endedAt }, meta),
    // Spec 06.7 AC14: no landing effects here — the provider's `onFinishSynced` owns them, once. A queued finish only
    // seeds the summary and clears the rest timer (AC15, §6.3 step 5); hook-level, so it runs after an unmount too.
    onSuccess: (outcome, { id }) => {
      if (outcome.status !== "queued") return;
      applyQueuedFinish(queryClient, { id, reason: outcome.reason, ops: outbox?.getState().ops ?? [], rest });
    },
  });
}

/**
 * Spec 06.7 AC15, §6.3 step 5: what a Finish tap that resolved `queued` does, and nothing else. It seeds the summary's
 * detail with the projected finished copy (the live copy with the waiting op applied, AC16), clears the rest timer (the
 * workout is over, D6) and tracks `workout_finish_queued { reason }`. No Hevy event, no `workout_finished`, drafts kept,
 * records and History untouched: the cloud doesn't have it yet. A failed op is never applied (AC19).
 */
export function applyQueuedFinish(
  queryClient: QueryClient,
  { id, reason, ops, rest }: { id: string; reason: "offline" | "slow"; ops: readonly OutboxOp[]; rest: Pick<RestStores, "clearWorkout"> | null | undefined },
): void {
  const active = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
  if (active?.id === id && waitingFinishOf(id, ops)) {
    queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id), withQueuedFinish(active, ops));
  }
  rest?.clearWorkout(id);
  track("workout_finish_queued", { reason });
}

/**
 * Spec 06.7 AC20: drop a finished workout the server no longer has (the gone card's Discard, AC30, the only caller):
 * its ops and id-map entries, drafts, rest timer and detail cache. Once: a second call finds no ops and does nothing.
 */
export function useDiscardUnsentWorkout(): (workoutId: string) => void {
  const queryClient = useQueryClient();
  const outbox = useOutbox();
  const drafts = useDraftStores();
  const rest = useRestStores();
  // Minor 631: one function while the stores stay the same, so a prop or an effect dependency doesn't churn.
  return useCallback(
    (workoutId: string) => {
      const ops = outbox?.getState().ops.filter((o) => o.workoutId === workoutId) ?? [];
      if (ops.length === 0) return;
      const setCount = ops.find(isFinishOp)?.meta.setCount ?? 0;
      outbox?.dropWorkout(workoutId);
      drafts?.clearWorkout(workoutId);
      rest?.clearWorkout(workoutId);
      queryClient.removeQueries({ queryKey: WORKOUT_KEYS.detail(workoutId), exact: true });
      // Final review: the server no longer has it, so a cached live copy is stale — drop it and ask again (null, or
      // the server's other active workout), never fall back to showing it as in progress.
      if (queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active)?.id === workoutId) {
        queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, null);
      }
      void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
      track("workout_discarded", { phase: "unsent", setCount });
    },
    [drafts, outbox, queryClient, rest],
  );
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
    onSuccess: async (_void, { id, phase, setCount }) => {
      drafts?.clearWorkout(id); // Spec 06.5 AC10
      rest?.clearWorkout(id); // Spec 17.1 AC47
      outbox?.dropWorkout(id); // Spec 18.0 AC25: an op for a workout the lifter just deleted must not be sent
      // An in-progress workout has no records and no History row (Spec 08.0 AC8).
      if (phase === "finished") applyDeletedCaches(queryClient, id);
      track("workout_discarded", { phase, setCount });
      await queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
      // Last, right before the caller navigates away: the summary and the edit screen still observe this detail, and
      // they re-render while the active read is out (`dropWorkout` notifies the outbox's readers, `useWaitingFinish`
      // among them). Removed any earlier, that re-render would re-read the deleted workout: a 404, and a spinner then
      // Not found on the screen (the browser smoke after #341).
      queryClient.removeQueries({ queryKey: WORKOUT_KEYS.detail(id) });
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
      // Minor 323: resolve once the new exercise is on screen (a set write can cancel one read), so a timed
      // section's join (10.7 AC22) sees it.
      return rereadUntilLanded(queryClient, WORKOUT_KEYS.active);
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
      // Minor 539: a set write's guard can cancel one re-read, so ask until it lands, as Add exercise does (minor 323).
      return rereadUntilLanded(queryClient, WORKOUT_KEYS.active);
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

export function useDeleteSet(): UseMutationResult<void, Error, { id: string; modality: Modality; viaUndo?: boolean }> {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_MUTATION_KEY,
    networkMode: "always",
    mutationFn: ({ id }) => ignoreNotFound(() => client.deleteSet(id)),
    onMutate: () => guardActiveReads(queryClient),
    onSettled: (_data, _error, _variables, guard) => rereadActiveIfStale(queryClient, guard),
    onSuccess: (_void, { id, modality, viaUndo }) => {
      queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => (d ? withSetRemoved(d, id) : d));
      track("set_deleted", { modality, viaUndo: viaUndo ?? false });
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
