import type { CreateSet, SetEntry, UpdateSet, WorkoutExercise } from "@sin/core";
import { ApiError } from "../../../api";
import { reportError } from "../../../observability/reportError";
import { track } from "../../../observability/track";
import { watchExternalWrites, type StorageAdapter } from "../../../storage/storage";
import type { WorkoutClient } from "../workoutClient";
import { backoffMs, classify, failureOf } from "./classify";
import { combine, isSetOp, OutboxFileSchema, sameTarget, type CreateOp, type IdMap, type NoteOp, type OpFailure, type OpTarget, type OutboxOp } from "./ops";

export const OUTBOX_KEY = "sin:workout:outbox";
/** An op that takes longer than this from enqueue to the server is tracked (`set_sync_delayed`). */
const DELAYED_MS = 2000;
/**
 * An op of a workout other than the active one fails after this many consecutive 5xx / 408 answers (deferred
 * minor 6): with the 1–30 s backoff that is about a minute and a half of a failing server, so a blip or a cold
 * start doesn't drop a late set. Network errors and 429s reset the count.
 */
export const OTHER_WORKOUT_MAX_SERVER_FAILURES = 8;

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
  rest: Pick<WorkoutClient, "createSet" | "updateSet" | "deleteSet" | "setExerciseNote">;
  userId: string;
  isOnline?: () => boolean;
  random?: () => number;
  newId?: () => string;
  /**
   * The live workout's id, `null` when there is none, `undefined` when not known. An op of another
   * workout that keeps meeting a 5xx / 408 fails after `OTHER_WORKOUT_MAX_SERVER_FAILURES`, so it can't hold
   * the live workout's sets behind it (the drain is oldest-first); 429s and network errors keep waiting.
   */
  activeWorkoutId?: () => string | null | undefined;
  /** An op reached the server. `row` is the server's row for a create / update, `null` for a delete. */
  onSynced?: (op: OutboxOp, row: SetEntry | null) => void;
  /** A note op reached the server: `exercise` is the server's row, `null` for the 404 "done" path (Spec 10.3 AC12). A note never calls `onSynced`. */
  onNoteSynced?: (op: NoteOp, exercise: WorkoutExercise | null) => void;
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
  /** Spec 10.3: queue one exercise's note (`null` clears it). Newer text replaces a never-sent op for the same exercise. */
  enqueueNote(input: SetWriteTarget & { body: { notes: string | null } }): void;
  /** How an op should name the set the screen shows as `setId` (a client key until its create syncs). */
  targetFor(setId: string): OpTarget;
  discard(opId: string): void;
  discardFailed(workoutId: string): void;
  /**
   * The gone path (Spec 18.0 AC25): keep every op of `activeWorkoutId` and the queued / sending ops of
   * other workouts (the server applies them to a finished workout, or 404s them for a deleted one);
   * remove failed ops of other workouts and every id-map entry no remaining op needs. No callback.
   */
  settle(activeWorkoutId: string | null): void;
  /** Remove every op and id-map entry of one workout (an own delete or discard). No callback. */
  dropWorkout(workoutId: string): void;
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

  async function call(op: OutboxOp): Promise<SetEntry | WorkoutExercise | null> {
    if (op.kind === "note") return rest.setExerciseNote(op.workoutExerciseId, op.body.notes);
    if (op.kind === "create") return rest.createSet(op.workoutExerciseId, op.body);
    const id = resolveSetId(op.target);
    if (id === null) throw new UnresolvedTarget();
    if (op.kind === "update") return rest.updateSet(id, op.body);
    await rest.deleteSet(id);
    return null;
  }

  function succeed(op: OutboxOp, result: SetEntry | WorkoutExercise | null): void {
    if (op.kind === "note") {
      // A note needs no id mapping and emits no set_* event (D13); the provider writes the server's copy into the cache.
      set({ ops: state.ops.filter((o) => o.id !== op.id) });
      deps.onNoteSynced?.(op, result as WorkoutExercise | null);
      return;
    }
    const row = result as SetEntry | null;
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
    // Rollback-only since 07.4 (Spec 18.0 AC26): no op can meet `workout-finished` unless the API is rolled back.
    const finished = failure.status === 409 && failure.type === "workout-finished";
    const key = op.kind === "create" ? op.target : null;
    const failing = new Set<string>([op.id]);
    state.ops.forEach((o, i) => {
      if (i <= index) return;
      if (finished && o.workoutId === op.workoutId) failing.add(o.id);
      if (key !== null && isSetOp(o) && sameTarget(o.target, key)) failing.add(o.id);
    });
    set({ ops: state.ops.map((o) => (failing.has(o.id) ? ({ ...o, status: "failed", failure } as OutboxOp) : o)) });
    const setFailures = state.ops.filter((o) => failing.has(o.id) && o.kind !== "note").length;
    for (let i = 0; i < setFailures; i += 1) track("set_sync_failed", { status: failure.status });
    deps.onFailed?.(op, error);
  }

  /** Consecutive 5xx / 408 answers per op, in memory (a reload starts the count again). */
  const serverFailures = new Map<string, number>();

  function givesUp(op: OutboxOp, error: unknown): boolean {
    if (!(error instanceof ApiError) || error.isNetworkError || error.status === 429) {
      serverFailures.delete(op.id);
      return false;
    }
    const count = (serverFailures.get(op.id) ?? 0) + 1;
    serverFailures.set(op.id, count);
    if (count < OTHER_WORKOUT_MAX_SERVER_FAILURES) return false;
    const active = deps.activeWorkoutId?.();
    return active !== undefined && active !== op.workoutId;
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
      else if (verdict === "retry" && givesUp(op, error)) fail(op, failureOf(error), error);
      else if (verdict === "retry") {
        // Spec 05.2 AC14: never retry sooner than the server's Retry-After.
        const floor = error instanceof ApiError ? (error.retryAfterMs ?? 0) : 0;
        patchOp(op.id, { status: "queued", nextAttemptAt: Date.now() + Math.max(backoffMs(attempts, random), floor) });
      }
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
    enqueueNote: (input) => enqueue({ ...opBase(input), kind: "note", body: input.body }),
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
      const target = op.kind === "note" ? null : op.target;
      const root = target ? state.ops.find((o) => o.kind === "create" && o.status === "failed" && sameTarget(o.target, target)) : undefined;
      if (op.status === "failed" && root) op = root;
      const chosen = op;
      const key = chosen.kind === "create" ? chosen.target : null;
      const removed = remove((o) => o.id === chosen.id || (key !== null && isSetOp(o) && sameTarget(o.target, key)));
      deps.onDiscarded?.(removed);
    },
    discardFailed: (workoutId) => {
      // A failed create takes its follow-ups with it, queued or not (code review #2): without the
      // create they can never resolve to a server id.
      const failedCreates = state.ops.filter((o): o is CreateOp => o.workoutId === workoutId && o.kind === "create" && o.status === "failed");
      const removed = remove(
        (o) =>
          (o.workoutId === workoutId && o.status === "failed") ||
          (isSetOp(o) && failedCreates.some((c) => sameTarget(o.target, c.target))),
      );
      if (removed.length > 0) deps.onDiscarded?.(removed);
    },
    settle: (activeWorkoutId) => {
      const ops = state.ops.filter((o) => o.workoutId === activeWorkoutId || o.status !== "failed");
      const targeted = new Set(ops.flatMap((o) => (isSetOp(o) && "clientGeneratedId" in o.target ? [o.target.clientGeneratedId] : [])));
      const idMap = Object.fromEntries(
        Object.entries(state.idMap).filter(([key, e]) => e.workoutId === activeWorkoutId || targeted.has(key)),
      );
      if (ops.length !== state.ops.length || Object.keys(idMap).length !== Object.keys(state.idMap).length) {
        set({ ops, idMap });
      }
    },
    dropWorkout: (workoutId) => {
      const ops = state.ops.filter((o) => o.workoutId !== workoutId);
      const idMap = Object.fromEntries(Object.entries(state.idMap).filter(([, e]) => e.workoutId !== workoutId));
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
