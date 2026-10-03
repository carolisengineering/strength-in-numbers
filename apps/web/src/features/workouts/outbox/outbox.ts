import type { CreateSet, SetEntry, UpdateSet } from "@sin/core";
import { reportError } from "../../../observability/reportError";
import type { StorageAdapter } from "../../../storage/storage";
import type { WorkoutClient } from "../workoutClient";
import { combine, OutboxFileSchema, sameTarget, type IdMap, type OpTarget, type OutboxOp } from "./ops";

export const OUTBOX_KEY = "sin:workout:outbox";

export interface OutboxState {
  readonly ops: readonly OutboxOp[];
  readonly idMap: IdMap;
  readonly online: boolean;
  /** Another tab wrote the outbox: this one has stopped sending and saving (AC19). */
  readonly conflict: boolean;
}

export interface OutboxDeps {
  storage: StorageAdapter;
  rest: Pick<WorkoutClient, "createSet" | "updateSet" | "deleteSet">;
  userId: string;
  isOnline?: () => boolean;
  random?: () => number;
  newId?: () => string;
  /** An op reached the server. `row` is the server's row for a create / update, `null` for a delete. */
  onSynced?: (op: OutboxOp, row: SetEntry | null) => void;
  /** An op became `failed` (called once, for the op the server answered; dependents fail with it). */
  onFailed?: (op: OutboxOp, error: unknown) => void;
  /** Ops removed by the lifter (Discard), so the screen can drop what it showed for them. */
  onDiscarded?: (ops: readonly OutboxOp[]) => void;
}

interface SetWriteTarget {
  workoutId: string;
  workoutExerciseId: string;
}

export interface Outbox {
  getState(): OutboxState;
  subscribe(listener: () => void): () => void;
  enqueueCreate(input: SetWriteTarget & { body: CreateSet & { clientGeneratedId: string } }): void;
  enqueueUpdate(input: SetWriteTarget & { target: OpTarget; body: UpdateSet }): void;
  enqueueDelete(input: SetWriteTarget & { target: OpTarget }): void;
  /** How an op should name the set the screen shows as `setId` (a client key until its create syncs). */
  targetFor(setId: string): OpTarget;
  discard(opId: string): void;
  discardFailed(workoutId: string): void;
  /** Drop every op (and id-map entry) for any workout other than `workoutId` — the gone path. */
  retainOnly(workoutId: string | null): void;
  retryNow(): void;
  /** Attach the online / visibility / cross-tab listeners and drain. Returns `stop`. */
  start(): () => void;
  drain(options?: { force?: boolean }): Promise<void>;
}

export type TestableOutbox = Outbox & {
  /** Test-only: replace the op list as if a drain had moved it. Never called by app code. */
  __setForTests(ops: readonly OutboxOp[]): void;
};

const EMPTY: { ops: readonly OutboxOp[]; idMap: IdMap } = { ops: [], idMap: {} };

/**
 * The persisted queue of set writes (Spec 06.2 §6). React-free: the provider wires it to TanStack
 * Query; tests drive it with `memoryStorageAdapter()`, a stub REST client and fake timers.
 */
export function createOutbox(deps: OutboxDeps): TestableOutbox {
  const { storage, userId } = deps;
  const isOnline = deps.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const newId = deps.newId ?? (() => crypto.randomUUID());

  const listeners = new Set<() => void>();
  let storageOk = true;

  const reportStorage = (error: unknown) => {
    if (!storageOk) return;
    storageOk = false;
    reportError(error, { source: "workout-storage" });
  };

  function load(): { ops: readonly OutboxOp[]; idMap: IdMap } {
    let raw: string | null;
    try {
      raw = storage.get(OUTBOX_KEY);
    } catch (error) {
      reportStorage(error);
      return EMPTY;
    }
    if (raw === null) return EMPTY;
    let parsed: ReturnType<typeof OutboxFileSchema.safeParse> | null;
    try {
      parsed = OutboxFileSchema.safeParse(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      reportError(new Error("unreadable outbox"), { source: "workout-storage" });
      try {
        storage.remove(OUTBOX_KEY);
      } catch {
        // Ignored either way: the value is not read again.
      }
      return EMPTY;
    }
    if (parsed.data.userId !== userId) return EMPTY;
    const ops = (parsed.data.ops as OutboxOp[])
      .filter((op) => op.userId === userId)
      .map((op) => (op.status === "sending" ? { ...op, status: "queued" as const, attempted: true } : op));
    return { ops, idMap: parsed.data.idMap };
  }

  let state: OutboxState = { ...load(), online: isOnline(), conflict: false };

  function persist(): void {
    if (!storageOk || state.conflict) return;
    try {
      if (state.ops.length === 0 && Object.keys(state.idMap).length === 0) storage.remove(OUTBOX_KEY);
      else storage.set(OUTBOX_KEY, JSON.stringify({ v: 1, userId, ops: state.ops, idMap: state.idMap }));
    } catch (error) {
      reportStorage(error);
    }
  }

  function set(next: Partial<OutboxState>, save = true): void {
    state = { ...state, ...next };
    if (save) persist();
    for (const listener of listeners) listener();
  }

  const opBase = (input: SetWriteTarget) => {
    const now = Date.now();
    return {
      id: newId(),
      workoutId: input.workoutId,
      workoutExerciseId: input.workoutExerciseId,
      userId,
      status: "queued" as const,
      attempted: false,
      attempts: 0,
      nextAttemptAt: now,
      enqueuedAt: now,
    };
  };

  function enqueue(op: OutboxOp): void {
    set({ ops: combine(state.ops, op) });
    void drain();
  }

  function remove(predicate: (op: OutboxOp) => boolean): OutboxOp[] {
    const removed: OutboxOp[] = [];
    const kept: OutboxOp[] = [];
    for (const op of state.ops) (predicate(op) ? removed : kept).push(op);
    if (removed.length > 0) set({ ops: kept });
    return removed;
  }

  // ---- draining ----------------------------------------------------------------------------------

  async function drain(): Promise<void> {
    // Sending lands with the drain loop.
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    enqueueCreate: (input) =>
      enqueue({ ...opBase(input), kind: "create", target: { clientGeneratedId: input.body.clientGeneratedId }, body: input.body }),
    enqueueUpdate: (input) => enqueue({ ...opBase(input), kind: "update", target: input.target, body: input.body }),
    enqueueDelete: (input) => enqueue({ ...opBase(input), kind: "delete", target: input.target, body: null }),
    targetFor: (setId) => {
      const mapped = state.idMap[setId];
      if (mapped) return { setId: mapped.setId };
      if (state.ops.some((op) => op.kind === "create" && op.target.clientGeneratedId === setId)) {
        return { clientGeneratedId: setId };
      }
      return { setId };
    },
    discard: (opId) => {
      const op = state.ops.find((o) => o.id === opId);
      if (!op) return;
      const key = op.kind === "create" ? op.target : null;
      const removed = remove((o) => o.id === opId || (key !== null && sameTarget(o.target, key)));
      deps.onDiscarded?.(removed);
    },
    discardFailed: (workoutId) => {
      const removed = remove((o) => o.workoutId === workoutId && o.status === "failed");
      if (removed.length > 0) deps.onDiscarded?.(removed);
    },
    retainOnly: (workoutId) => {
      const ops = state.ops.filter((o) => o.workoutId === workoutId);
      const idMap = Object.fromEntries(Object.entries(state.idMap).filter(([, e]) => e.workoutId === workoutId));
      if (ops.length !== state.ops.length || Object.keys(idMap).length !== Object.keys(state.idMap).length) {
        set({ ops, idMap });
      }
    },
    retryNow: () => {
      const now = Date.now();
      set({ ops: state.ops.map((o) => (o.status === "queued" ? { ...o, nextAttemptAt: now } : o)) });
      void drain();
    },
    start: () => {
      void drain();
      return () => {};
    },
    drain,
    __setForTests: (ops) => set({ ops }),
  };
}
