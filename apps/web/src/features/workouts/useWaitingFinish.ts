import { useMemo } from "react";
import { useOutboxState } from "./outbox/OutboxContext";
import { isFinishOp, type FinishOp } from "./outbox/ops";

export interface WaitingFinish {
  /** The finish op (waiting or refused), or `null`. */
  op: FinishOp | null;
  /** Queued or sending: saved on this phone, not yet in the cloud. */
  waiting: boolean;
  /** The server refused it (AC19, AC29). */
  failed: boolean;
}

/**
 * Spec 06.7 §6.11: the only reader of "is a finish waiting". A pure selector over the outbox's ops, never over
 * `endedAt` (`["workouts","active"]` never shows an unsent finish). With no `workoutId`, any workout's finish op counts
 * (the Workouts screen's card); with one, only that workout's.
 */
export function useWaitingFinish(workoutId?: string): WaitingFinish {
  const { ops } = useOutboxState();
  return useMemo(() => {
    const op = ops.find((o): o is FinishOp => isFinishOp(o) && (workoutId === undefined || o.workoutId === workoutId)) ?? null;
    return { op, waiting: op !== null && op.status !== "failed", failed: op?.status === "failed" };
  }, [ops, workoutId]);
}
