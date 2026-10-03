import type { CreateSet, SetEntry, UpdateSet } from "@sin/core";
import { reportError } from "../../../observability/reportError";
import { track } from "../../../observability/track";
import { watchExternalWrites, type StorageAdapter } from "../../../storage/storage";
import type { WorkoutClient } from "../workoutClient";
import { backoffMs, classify, failureOf } from "./classify";
import { combine, OutboxFileSchema, sameTarget, type IdMap, type OpFailure, type OpTarget, type OutboxOp } from "./ops";

export const OUTBOX_KEY = "sin:workout:outbox";
/** An op that takes longer than this from enqueue to the server is tracked (`set_sync_delayed`). */
const DELAYED_MS = 2000;

/** An update / delete whose set's create never synced: there is no server id to send it to. */
class UnresolvedTarget extends Error {}

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
  const { storage, rest, userId } = deps;
  const isOnline = deps.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const random = deps.random ?? Math.random;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  const listeners = new Set<() => void>();
  let storageOk = true;
  let draining = false;
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

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

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(ms: number): void {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, ms);
  }

  function patchOp(id: string, change: Partial<OutboxOp>): void {
    set({ ops: state.ops.map((o) => (o.id === id ? ({ ...o, ...change } as OutboxOp) : o)) });
  }

  function resolveSetId(target: OpTarget): string | null {
    if ("setId" in target) return target.setId;
    return state.idMap[target.clientGeneratedId]?.setId ?? null;
  }

  async function call(op: OutboxOp): Promise<SetEntry | null> {
    if (op.kind === "create") return rest.createSet(op.workoutExerciseId, op.body);
    const id = resolveSetId(op.target);
    if (id === null) throw new UnresolvedTarget();
    if (op.kind === "update") return rest.updateSet(id, op.body);
    await rest.deleteSet(id);
    return null;
  }

  function succeed(op: OutboxOp, row: SetEntry | null): void {
    const idMap =
      op.kind === "create" && row
        ? { ...state.idMap, [op.target.clientGeneratedId]: { setId: row.id, workoutId: op.workoutId } }
        : state.idMap;
    set({ ops: state.ops.filter((o) => o.id !== op.id), idMap });
    const ms = Date.now() - op.enqueuedAt;
    if (ms > DELAYED_MS) track("set_sync_delayed", { ms });
    deps.onSynced?.(op, row);
  }

  /**
   * Fail `op`, plus every later op that cannot succeed without it: ops of a create that failed, and —
   * on `409 workout-finished` — every later op of that workout (AC4, AC17).
   */
  function fail(op: OutboxOp, failure: OpFailure, error: unknown): void {
    const index = state.ops.findIndex((o) => o.id === op.id);
    const finished = failure.status === 409 && failure.type === "workout-finished";
    const key = op.kind === "create" ? op.target : null;
    const failing = new Set<string>([op.id]);
    state.ops.forEach((o, i) => {
      if (i <= index) return;
      if (finished && o.workoutId === op.workoutId) failing.add(o.id);
      if (key !== null && sameTarget(o.target, key)) failing.add(o.id);
    });
    set({ ops: state.ops.map((o) => (failing.has(o.id) ? ({ ...o, status: "failed", failure } as OutboxOp) : o)) });
    for (let i = 0; i < failing.size; i += 1) track("set_sync_failed", { status: failure.status });
    deps.onFailed?.(op, error);
  }

  async function send(op: OutboxOp): Promise<void> {
    const attempts = op.attempts + 1;
    patchOp(op.id, { status: "sending", attempted: true, attempts });
    try {
      succeed(op, await call(op));
    } catch (error) {
      if (error instanceof UnresolvedTarget) {
        fail(op, { status: 0, type: "unresolved", requestId: null }, error);
        return;
      }
      const verdict = classify(op.kind, error);
      if (verdict === "done") succeed(op, null);
      else if (verdict === "retry") patchOp(op.id, { status: "queued", nextAttemptAt: Date.now() + backoffMs(attempts, random) });
      else fail(op, failureOf(error), error);
    }
  }

  /** One loop, one op in flight, oldest first (AC4). `force` makes one attempt even offline (Retry now). */
  async function drain({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (draining || stopped || state.conflict) return;
    draining = true;
    let forced = force;
    try {
      for (;;) {
        const op = state.ops.find((o) => o.status !== "failed");
        if (!op) return;
        if (!forced && !isOnline()) return;
        const wait = op.nextAttemptAt - Date.now();
        if (!forced && wait > 0) {
          schedule(wait);
          return;
        }
        forced = false;
        await send(op);
      }
    } finally {
      draining = false;
    }
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
      let op = state.ops.find((o) => o.id === opId);
      if (!op) return;
      // A follow-up of a create that failed too: discarding it means discarding that set — the create
      // and every follow-up (final review I2), or the row would stay with one "Couldn't save" left.
      const target = op.target;
      const root = state.ops.find((o) => o.kind === "create" && o.status === "failed" && sameTarget(o.target, target));
      if (op.status === "failed" && root) op = root;
      const chosen = op;
      const key = chosen.kind === "create" ? chosen.target : null;
      const removed = remove((o) => o.id === chosen.id || (key !== null && sameTarget(o.target, key)));
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
      clearTimer();
      const now = Date.now();
      set({ ops: state.ops.map((o) => (o.status === "queued" ? { ...o, nextAttemptAt: now } : o)) });
      void drain({ force: true });
    },
    start: () => {
      stopped = false;
      const onOnline = () => {
        set({ online: true }, false);
        void drain();
      };
      const onOffline = () => set({ online: false }, false);
      const onVisible = () => {
        if (document.visibilityState === "visible") void drain();
      };
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      document.addEventListener("visibilitychange", onVisible);
      const unwatch = watchExternalWrites(OUTBOX_KEY, () => {
        clearTimer();
        set({ conflict: true }, false);
      });
      void drain();
      return () => {
        stopped = true;
        clearTimer();
        unwatch();
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        document.removeEventListener("visibilitychange", onVisible);
      };
    },
    drain,
    __setForTests: (ops) => set({ ops }),
  };
}
