import { useEffect, useMemo, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SetEntry, WorkoutDetail } from "@sin/core";
import { ApiError } from "../../api";
import { useApi } from "../../auth/useApi";
import { localStorageAdapter, type StorageAdapter } from "../../storage/storage";
import { withSetRemoved, withSetUpserted } from "./cache";
import { createOutbox, type Outbox } from "./outbox/outbox";
import { OutboxContext } from "./outbox/OutboxContext";
import type { OutboxOp } from "./outbox/ops";
import { project } from "./outbox/project";
import { createQueuedWorkoutClient } from "./outbox/queuedWorkoutClient";
import { WORKOUT_KEYS, WorkoutClientContext } from "./queries";
import { reportUnexpected } from "./reportUnexpected";
import { createWorkoutClient } from "./workoutClient";

const REPORT_OP = { create: "create-set", update: "update-set", delete: "delete-set" } as const;

/** Swap a synced op's local row for the server's, then re-overlay what is still queued (AC12). */
function applySynced(queryClient: QueryClient, outbox: Outbox, op: OutboxOp, row: SetEntry | null): void {
  queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => {
    if (!d || d.id !== op.workoutId) return d;
    let next = op.kind === "create" ? withSetRemoved(d, op.target.clientGeneratedId) : d;
    if (row) next = withSetUpserted(next, row);
    return project(next, outbox.getState()).workout;
  });
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
  const { outbox, client } = useMemo(() => {
    const rest = createWorkoutClient(api);
    const outbox: Outbox = createOutbox({
      storage: storage ?? localStorageAdapter(),
      rest,
      userId,
      onSynced: (op, row) => applySynced(queryClient, outbox, op, row),
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
    return { outbox, client };
  }, [api, queryClient, storage, userId]);

  useEffect(() => outbox.start(), [outbox]);

  return (
    <OutboxContext.Provider value={outbox}>
      <WorkoutClientContext.Provider value={client}>{children}</WorkoutClientContext.Provider>
    </OutboxContext.Provider>
  );
}
