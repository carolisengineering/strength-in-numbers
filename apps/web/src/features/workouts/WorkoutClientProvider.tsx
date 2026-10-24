import { useEffect, useMemo, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SetEntry, WorkoutDetail, WorkoutExercise } from "@sin/core";
import { ApiError } from "../../api";
import { useApi } from "../../auth/useApi";
import { localStorageAdapter, type StorageAdapter } from "../../storage/storage";
import { applyEditedCaches } from "../records/cache";
import { withExerciseNotes, withSetRemoved, withSetUpserted } from "./cache";
import { createDraftStores } from "./drafts/draftStore";
import { DraftStoresContext } from "./drafts/DraftStoreContext";
import { createRestStores } from "./restStore";
import { RestStoresContext } from "./useRestTimer";
import { createOutbox, type Outbox } from "./outbox/outbox";
import { OutboxContext } from "./outbox/OutboxContext";
import type { NoteOp, OutboxOp } from "./outbox/ops";
import { project } from "./outbox/project";
import { createQueuedWorkoutClient } from "./outbox/queuedWorkoutClient";
import { EditWorkoutClientContext, WORKOUT_KEYS, WorkoutClientContext } from "./queries";
import { reportUnexpected } from "./reportUnexpected";
import { createWorkoutClient } from "./workoutClient";

const REPORT_OP = { create: "create-set", update: "update-set", delete: "delete-set", note: "update-note" } as const;

/**
 * Swap a synced op's local row for the server's, then re-overlay what is still queued (AC12). A read
 * of `/active` already in flight may hold a snapshot from before this write; it would land with the op
 * gone from the outbox and erase the row. So cancel it first and re-read once the cache is written —
 * the same move as `cancelActiveReads` for the mutation hooks.
 */
function applySynced(queryClient: QueryClient, outbox: Outbox, op: OutboxOp, row: SetEntry | null): void {
  const interrupted = queryClient.isFetching({ queryKey: WORKOUT_KEYS.active }) > 0;
  void queryClient.cancelQueries({ queryKey: WORKOUT_KEYS.active }).then(() => {
    queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => {
      if (!d || d.id !== op.workoutId) return d;
      let next = op.kind === "create" ? withSetRemoved(d, op.target.clientGeneratedId) : d;
      if (row) next = withSetUpserted(next, row);
      return project(next, outbox.getState()).workout;
    });
    if (interrupted) void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
  });
}

/** A synced note: write the server's copy over the optimistic one, then re-overlay what is still queued. `null` = a 404 "done": refetch. */
function applyNoteSynced(queryClient: QueryClient, outbox: Outbox, op: NoteOp, exercise: WorkoutExercise | null): void {
  const interrupted = queryClient.isFetching({ queryKey: WORKOUT_KEYS.active }) > 0;
  void queryClient.cancelQueries({ queryKey: WORKOUT_KEYS.active }).then(() => {
    queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => {
      if (!d || d.id !== op.workoutId) return d;
      return project(exercise ? withExerciseNotes(d, exercise) : d, outbox.getState()).workout;
    });
    if (interrupted || exercise === null) void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
  });
}

/**
 * Spec 18.0 AC24: an op that landed on a workout that is not the cached active one (finished on another
 * device; 07.4 applies it and recomputes records) changed a finished workout: refresh what shows it.
 * With no `/active` in the cache (a reload onto History or Progress) only a cached finished detail
 * proves the workout is finished; otherwise the op is taken to be the live one's, and History keeps its
 * page until its own next read.
 */
function refreshFinishedElsewhere(queryClient: QueryClient, workoutId: string): void {
  const active = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
  if (active === undefined) {
    if (!queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workoutId))?.endedAt) return;
  } else if (active?.id === workoutId) return;
  applyEditedCaches(queryClient);
  void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.detail(workoutId) });
}

/** A discarded create's row goes at once; a discarded edit or delete needs the server's copy back. */
function applyDiscarded(queryClient: QueryClient, ops: readonly OutboxOp[]): void {
  queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) =>
    ops.reduce<WorkoutDetail | null | undefined>(
      (acc, op) => (acc && op.kind === "create" ? withSetRemoved(acc, op.target.clientGeneratedId) : acc),
      d,
    ),
  );
  if (ops.some((op) => op.kind !== "create")) void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
}

export interface WorkoutClientProviderProps {
  /** `Me.id`: the outbox only sends ops this user queued (Spec 06.2 AC8, D12). */
  userId: string;
  /** Defaults to `localStorageAdapter()`; tests pass an in-memory adapter. */
  storage?: StorageAdapter;
  children: ReactNode;
}

/** Supplies the queue-backed `WorkoutClient` and its outbox (Spec 06.2 §6.5). */
export function WorkoutClientProvider({ userId, storage, children }: WorkoutClientProviderProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  // `rest` inside the memo is the REST client; the memo's returned `rest` is the rest-timer stores.
  const { outbox, client, editClient, drafts, rest } = useMemo(() => {
    const adapter = storage ?? localStorageAdapter();
    const rest = createWorkoutClient(api);
    const outbox: Outbox = createOutbox({
      storage: adapter,
      rest,
      userId,
      onSynced: (op, row) => {
        applySynced(queryClient, outbox, op, row);
        refreshFinishedElsewhere(queryClient, op.workoutId);
      },
      onNoteSynced: (op, exercise) => {
        applyNoteSynced(queryClient, outbox, op, exercise);
        refreshFinishedElsewhere(queryClient, op.workoutId);
      },
      onFailed: (op, error) => {
        reportUnexpected(REPORT_OP[op.kind], error);
        if (error instanceof ApiError && error.status === 404) {
          void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
        }
      },
      onDiscarded: (ops) => applyDiscarded(queryClient, ops),
    });
    const client = createQueuedWorkoutClient({
      rest,
      outbox,
      cached: () => queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active),
    });
    return {
      outbox,
      client,
      editClient: rest, // Spec 18.0 D5: edit mode's plain REST client
      drafts: createDraftStores(adapter, userId),
      rest: createRestStores(adapter, userId),
    };
  }, [api, queryClient, storage, userId]);

  useEffect(() => outbox.start(), [outbox]);
  useEffect(() => () => drafts.flushAll(), [drafts]);

  return (
    <OutboxContext.Provider value={outbox}>
      <DraftStoresContext.Provider value={drafts}>
        <RestStoresContext.Provider value={rest}>
          <WorkoutClientContext.Provider value={client}>
            <EditWorkoutClientContext.Provider value={editClient}>{children}</EditWorkoutClientContext.Provider>
          </WorkoutClientContext.Provider>
        </RestStoresContext.Provider>
      </DraftStoresContext.Provider>
    </OutboxContext.Provider>
  );
}
