import type {
  CreateSet,
  SetEntry,
  SetSectionResult,
  UpdateSet,
  UpdatedWorkout,
  WorkoutDetail,
  WorkoutExercise,
  WorkoutSection,
} from "@sin/core";
import { ApiError, newRequestId } from "../../../api";
import { reportError } from "../../../observability/reportError";
import { track } from "../../../observability/track";
import { LEGACY_OUTBOX_FILE, OUTBOX_FILE_PREFIX } from "../../../storage/clearUserData";
import { watchExternalWrites, type StorageAdapter } from "../../../storage/storage";
import type { SendOptions, WorkoutClient } from "../workoutClient";
import { backoffMs, classify, failureOf, lostSession } from "./classify";
import {
  combine,
  isFinishOp,
  isSectionOp,
  isSetOp,
  OutboxOpSchema,
  parseOutboxFile,
  sameTarget,
  type CreateOp,
  type FinishMeta,
  type FinishOp,
  type IdMap,
  type NoteOp,
  type OpFailure,
  type OpTarget,
  type OutboxOp,
  type SectionOp,
} from "./ops";

/** Spec 06.7 AC8: one outbox file per account, so a forced sign-out can keep it and another person never reads it. */
export const outboxKey = (userId: string): string => `${OUTBOX_FILE_PREFIX}${userId}`;
/** The single file of releases before 06.7: read once, for adoption into the per-user key, and never written again. */
export const LEGACY_OUTBOX_KEY = LEGACY_OUTBOX_FILE;
/** Spec 06.7 AC5: a send that has not answered by now is a network failure (retried with the backoff). */
export const SEND_TIMEOUT_MS = 20_000;
/** An op that takes longer than this from enqueue to the server is tracked (`set_sync_delayed`). */
const DELAYED_MS = 2000;

/** An update / delete whose set's create never synced: there is no server id to send it to. */
class UnresolvedTarget extends Error {}

/** A REST method a timer entry or a finish needs; a client without it is a wiring mistake (a set-only test stub). */
function need<F>(method: F | undefined): F {
  if (method === undefined) throw new Error("outbox: the REST client lacks a timer-entry or finish method");
  return method;
}

/** Spec 06.7 AC3: how a finish left the queue by success. `ours` = our earlier reply was lost; `elsewhere` = another device finished it. */
export type FinishSyncResult =
  | { outcome: "landed"; updated: UpdatedWorkout }
  | { outcome: "ours" | "elsewhere"; detail: WorkoutDetail };

export interface OutboxState {
  readonly ops: readonly OutboxOp[];
  readonly idMap: IdMap;
  readonly online: boolean;
  /** Another tab wrote the outbox: this one has stopped sending and saving (AC19). */
  readonly conflict: boolean;
  /**
   * Spec 06.7 AC10: "saved on this phone" is true. False once a storage read or write threw (this store stops writing)
   * or while `conflict` is true; true for an outbox that has never had to write.
   */
  readonly durable: boolean;
}

export interface OutboxDeps {
  storage: StorageAdapter;
  /** The timer-entry methods (Spec 10.7) are optional so a set-only stub still types; the provider passes them all. */
  rest: Pick<WorkoutClient, "createSet" | "updateSet" | "deleteSet" | "setExerciseNote"> &
    Partial<Pick<WorkoutClient, "putRoundTime" | "deleteRoundTime" | "putResult" | "deleteResult" | "finish" | "getById">>;
  userId: string;
  isOnline?: () => boolean;
  random?: () => number;
  newId?: () => string;
  /**
   * The live workout's id, `null` when there is none, `undefined` when not known. While the oldest op belongs to
   * another workout and is backing off, the live workout's ops may go first (deferred minor 6).
   */
  activeWorkoutId?: () => string | null | undefined;
  /** An op reached the server. `row` is the server's row for a create / update, `null` for a delete. */
  onSynced?: (op: OutboxOp, row: SetEntry | null) => void;
  /** A note op reached the server: `exercise` is the server's row, `null` for the 404 "done" path (Spec 10.3 AC12). A note never calls `onSynced`. */
  onNoteSynced?: (op: NoteOp, exercise: WorkoutExercise | null) => void;
  /**
   * Spec 10.7 AC37: a timer entry reached the server. `section` is the server's section for a `PUT`; `null` with
   * `gone: false` for a `204` clear, `null` with `gone: true` for the `404` "done" path. It never calls `onSynced`.
   */
  onSectionSynced?: (op: SectionOp, section: WorkoutSection | null, gone: boolean) => void;
  /** An op became `failed` (called once, for the op the server answered; dependents fail with it). Never for a finish. */
  onFailed?: (op: OutboxOp, error: unknown) => void;
  /** Spec 06.7 AC3, AC14: a finish left the queue by success; called before any `whenFinishSettles` waiter resolves. */
  onFinishSynced?: (op: FinishOp, result: FinishSyncResult) => void;
  /**
   * Spec 06.7 AC2, AC12: a finish op became `failed`, by its own answer or blocked by an earlier failed op of its
   * workout (`failure.blockedBy`); `error` is what failed it (`null` when the blocking op failed before a reload).
   */
  onFinishFailed?: (op: FinishOp, error: unknown) => void;
  /** Ops removed by the lifter (Discard), so the screen can drop what it showed for them. */
  onDiscarded?: (ops: readonly OutboxOp[]) => void;
}

interface SetWriteTarget {
  workoutId: string;
  workoutExerciseId: string;
}

interface SectionWriteTarget {
  workoutId: string;
  sectionId: string;
}

export interface Outbox {
  getState(): OutboxState;
  subscribe(listener: () => void): () => void;
  /**
   * The `enqueue*` writes return `false` when refused: the workout has a waiting finish (Spec 06.7 AC2, minor 613), so
   * nothing was queued and the caller must not show it as saved.
   */
  enqueueCreate(input: SetWriteTarget & { body: CreateSet & { clientGeneratedId: string } }): boolean;
  enqueueUpdate(input: SetWriteTarget & { target: OpTarget; body: UpdateSet }): boolean;
  enqueueDelete(input: SetWriteTarget & { target: OpTarget }): boolean;
  /** Spec 10.3: queue one exercise's note (`null` clears it). Newer text replaces a never-sent op for the same exercise. */
  enqueueNote(input: SetWriteTarget & { body: { notes: string | null } }): boolean;
  /** Spec 10.7 AC34: queue one round's final time (`null` clears it). AC35 decides whether it replaces the last op. */
  enqueueRound(input: SectionWriteTarget & { round: number; body: { seconds: number | null } }): boolean;
  /** Spec 10.7 AC34: queue the section's result (`null` clears it). */
  enqueueResult(input: SectionWriteTarget & { body: SetSectionResult | null }): boolean;
  /**
   * Spec 06.7 AC2: queue the workout's finish and return its op id. An op that doesn't fit `OutboxOpSchema` throws (a
   * programming error, minor 614): written, it would fail the whole file on the next load. A queued or sending finish of the workout is kept
   * (its id is returned); a failed one is replaced by a fresh op. It sends once no other op of its workout is queued.
   */
  enqueueFinish(input: { workoutId: string; body: FinishOp["body"]; meta: FinishMeta }): string;
  /** Spec 06.7 §6.3: `landed` once the finish op left by success, `pending` at `ms`, on a failure, or for an unknown op. Never cancels the send. */
  whenFinishSettles(opId: string, ms: number): Promise<"landed" | "pending">;
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
  /** Minor 618: Retry now was tapped during a send; if that send goes back to the queue, it goes again at once. */
  let retryRequested = false;
  /** Set when the flag was spent: the drain loop's next attempt is forced, even offline, as Retry now's is. */
  let retryForced = false;
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reportStorage = (error: unknown) => {
    if (!storageOk) return;
    storageOk = false;
    reportError(error, { source: "workout-storage" });
  };

  const key = outboxKey(userId);

  /** Read and parse one file: `"absent"`, or `"bad"` when unreadable (reported, and the unreadable value removed: nobody can use it). */
  function readFile(fileKey: string): NonNullable<ReturnType<typeof parseOutboxFile>> | "absent" | "bad" {
    let raw: string | null;
    try {
      raw = storage.get(fileKey);
    } catch (error) {
      reportStorage(error);
      return "bad";
    }
    if (raw === null) return "absent";
    let parsed: ReturnType<typeof parseOutboxFile>;
    try {
      parsed = parseOutboxFile(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      reportError(new Error("unreadable outbox"), { source: "workout-storage" });
      try {
        storage.remove(fileKey);
      } catch {
        // Ignored either way: the value is not read again.
      }
      return "bad";
    }
    // Spec 10.7 AC66: ops of a kind this bundle doesn't know are left out (the next persist drops them); said once,
    // statically — never their contents or how many.
    if (parsed.skipped > 0) reportError(new Error("outbox ops of an unknown kind skipped"), { source: "workout-storage" });
    return parsed;
  }

  const ownOps = (parsed: NonNullable<ReturnType<typeof parseOutboxFile>>): { ops: readonly OutboxOp[]; idMap: IdMap } => ({
    ops: parsed.ops
      .filter((op) => op.userId === userId)
      .map((op) => (op.status === "sending" ? { ...op, status: "queued" as const, attempted: true } : op)),
    idMap: parsed.idMap,
  });

  /**
   * Spec 06.7 AC8: the per-user file; if absent, a legacy file of this user is adopted (written to the per-user key,
   * then removed; a failed write leaves it). Another user's legacy file is left alone. An existing per-user file wins
   * and nothing merges. A corrupt file drops that key only.
   */
  function load(): { ops: readonly OutboxOp[]; idMap: IdMap } {
    const own = readFile(key);
    if (own === "bad") return EMPTY;
    if (own !== "absent") return own.userId === userId ? ownOps(own) : EMPTY;
    const legacy = readFile(LEGACY_OUTBOX_KEY);
    if (legacy === "bad" || legacy === "absent" || legacy.userId !== userId) return EMPTY;
    const adopted = ownOps(legacy);
    try {
      if (legacy.ops.length > 0 || Object.keys(legacy.idMap).length > 0) {
        storage.set(key, JSON.stringify({ v: 1, userId, ops: legacy.ops, idMap: legacy.idMap }));
      }
      storage.remove(LEGACY_OUTBOX_KEY);
    } catch (error) {
      reportStorage(error);
    }
    return adopted;
  }

  let state: OutboxState = { ...load(), online: isOnline(), conflict: false, durable: storageOk };

  function persist(): void {
    if (!storageOk || state.conflict) return;
    try {
      if (state.ops.length === 0 && Object.keys(state.idMap).length === 0) storage.remove(key);
      else storage.set(key, JSON.stringify({ v: 1, userId, ops: state.ops, idMap: state.idMap }));
    } catch (error) {
      reportStorage(error);
    }
  }

  function set(next: Partial<OutboxState>, save = true): void {
    state = { ...state, ...next };
    if (save) persist();
    const durable = storageOk && !state.conflict;
    if (durable !== state.durable) state = { ...state, durable };
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

  /** A timer entry's common fields: on a section, with no exercise (Spec 10.7 AC34). */
  const sectionOpBase = (input: SectionWriteTarget) => {
    const now = Date.now();
    return {
      id: newId(),
      workoutId: input.workoutId,
      sectionId: input.sectionId,
      userId,
      status: "queued" as const,
      attempted: false,
      attempts: 0,
      nextAttemptAt: now,
      enqueuedAt: now,
    };
  };

  /** Spec 06.7 AC2: the workout has a finish that may still send (queued or sending). */
  const finishPending = (workoutId: string) => state.ops.some((o) => isFinishOp(o) && o.workoutId === workoutId && o.status !== "failed");
  /** Spec 06.7 AC6: the workout has a finish op in the queue, in any status. */
  const hasFinish = (workoutId: string) => state.ops.some((o) => isFinishOp(o) && o.workoutId === workoutId);

  let refusedReported = false;
  function enqueue(op: OutboxOp): boolean {
    if (finishPending(op.workoutId)) {
      // Spec 06.7 AC2: nothing joins a workout that is finishing; the screens never offer it, so this is a defensive
      // refusal, said to the caller (minor 613) and reported once.
      if (!refusedReported) {
        refusedReported = true;
        reportError(new Error("outbox write refused: the workout is finishing"), { source: "workout-outbox" });
      }
      return false;
    }
    set({ ops: combine(state.ops, op) });
    void drain();
    return true;
  }

  // Spec 06.7 §6.3: who waits for which finish, and the finishes that landed in this page load.
  const finishWaiters = new Map<string, Set<(result: "landed" | "pending") => void>>();
  const landedFinishes = new Set<string>();
  function settleFinish(opId: string, result: "landed" | "pending"): void {
    const waiting = finishWaiters.get(opId);
    if (!waiting) return;
    finishWaiters.delete(opId);
    for (const resolve of waiting) resolve(result);
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

  async function call(op: Exclude<OutboxOp, FinishOp>, options: SendOptions): Promise<SetEntry | WorkoutExercise | WorkoutSection | null> {
    if (op.kind === "note") return rest.setExerciseNote(op.workoutExerciseId, op.body.notes, options);
    if (op.kind === "create") return rest.createSet(op.workoutExerciseId, op.body, options);
    // Spec 10.7 AC37: a timer entry is a keyed set or clear on its section; a clear answers 204.
    if (op.kind === "round") {
      if (op.body.seconds !== null) return need(rest.putRoundTime)(op.sectionId, op.round, op.body.seconds, options);
      await need(rest.deleteRoundTime)(op.sectionId, op.round, options);
      return null;
    }
    if (op.kind === "result") {
      if (op.body !== null) return need(rest.putResult)(op.sectionId, op.body, options);
      await need(rest.deleteResult)(op.sectionId, options);
      return null;
    }
    const id = resolveSetId(op.target);
    if (id === null) throw new UnresolvedTarget();
    if (op.kind === "update") return rest.updateSet(id, op.body, options);
    await rest.deleteSet(id, options);
    return null;
  }

  /**
   * Spec 06.7 AC5: one attempt with a deadline. The signal aborts the request at `SEND_TIMEOUT_MS`, and the race ends
   * the attempt even when something ignores the signal (a hung token fetch). The race settles once, so a reply that
   * arrives after the deadline is never seen: the op is already back in the queue and its replay is safe (06.2's key).
   */
  async function attempt<T>(run: (options: SendOptions) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        controller.abort();
        // Minor 622 (won't fix): a fresh id, not the sent one; nothing surfaces it. Carry the sent id through before showing it.
        reject(ApiError.network(newRequestId(), new Error("outbox send timed out")));
      }, SEND_TIMEOUT_MS);
    });
    try {
      return await Promise.race([run({ signal: controller.signal }), timedOut]);
    } finally {
      clearTimeout(deadline);
    }
  }

  function succeed(op: Exclude<OutboxOp, FinishOp>, result: SetEntry | WorkoutExercise | WorkoutSection | null, gone = false): void {
    if (isSectionOp(op)) {
      // A timer entry needs no id mapping and emits no set_* event; the provider writes the section into the cache.
      set({ ops: state.ops.filter((o) => o.id !== op.id) });
      deps.onSectionSynced?.(op, result as WorkoutSection | null, gone);
      return;
    }
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

  /** Spec 06.7 AC3: the finish left by success. No set_* event (AC12); the provider's landing effects run before any waiter. */
  function landFinish(op: FinishOp, result: FinishSyncResult): void {
    // Minor 629: a finish dropped or discarded mid-send was thrown away by the lifter: its late success runs no landing
    // (no Hevy event, no landed line, no caches for a workout they discarded).
    if (!state.ops.some((o) => o.id === op.id)) {
      settleFinish(op.id, "pending");
      return;
    }
    set({ ops: state.ops.filter((o) => o.id !== op.id) });
    landedFinishes.add(op.id);
    try {
      deps.onFinishSynced?.(op, result);
    } catch (error) {
      // Minor 626: the cloud has it whatever the landing effects did; a throw must not strand the tap or the queue.
      reportError(error, { source: "workout-outbox" });
    } finally {
      settleFinish(op.id, "landed");
    }
  }

  /** A finish failed: said once, by its own event (AC12), never as a set failure or through `onFailed`. */
  function finishFailed(op: FinishOp, failure: OpFailure, error: unknown): void {
    track("workout_finish_failed", { status: failure.blockedBy === undefined ? failure.status : 0 });
    deps.onFinishFailed?.(op, error);
    settleFinish(op.id, "pending");
  }

  /**
   * Spec 06.7 AC2: a finish whose workout has a failed op can't go without it (that would drop a write the lifter
   * believes is saved): it fails too, with the same failure and `blockedBy` naming the op. An op that failed on a lost
   * sign-in doesn't count (minor 633): the finish stays queued behind it, and `sendable` keeps it waiting.
   */
  function blockFinishes(error: unknown): void {
    const blocked: FinishOp[] = [];
    const ops = state.ops.map((o) => {
      if (!isFinishOp(o) || o.status === "failed") return o;
      const root = state.ops.find((r) => !isFinishOp(r) && r.workoutId === o.workoutId && r.status === "failed" && !lostSession(r.failure));
      if (!root) return o;
      // `failure` is optional in the file: a failed op without one must still block, or the finish would wait forever.
      const failure = root.failure ?? { status: 0, type: "unknown", requestId: null };
      const next: FinishOp = { ...o, status: "failed", failure: { ...failure, blockedBy: root.id } };
      blocked.push(next);
      return next;
    });
    if (blocked.length === 0) return;
    set({ ops });
    for (const op of blocked) finishFailed(op, op.failure!, error);
  }

  /**
   * Fail `op`, plus every later op that cannot succeed without it: ops of a create that failed, and —
   * on `409 workout-finished` — every later op of that workout (AC4, AC17). A finish of the workout fails with it,
   * blocked (Spec 06.7 AC2).
   */
  function fail(op: OutboxOp, failure: OpFailure, error: unknown): void {
    const index = state.ops.findIndex((o) => o.id === op.id);
    // Minor 616: a finish dropped or discarded mid-send is gone; its late refusal has no one left to tell.
    if (index === -1 && isFinishOp(op)) {
      settleFinish(op.id, "pending");
      return;
    }
    // Rollback-only since 07.4 (Spec 18.0 AC26): no op can meet `workout-finished` unless the API is rolled back.
    const finished = !isFinishOp(op) && failure.status === 409 && failure.type === "workout-finished";
    const key = op.kind === "create" ? op.target : null;
    const failing = new Set<string>([op.id]);
    state.ops.forEach((o, i) => {
      if (i <= index || isFinishOp(o)) return;
      if (finished && o.workoutId === op.workoutId) failing.add(o.id);
      if (key !== null && isSetOp(o) && sameTarget(o.target, key)) failing.add(o.id);
    });
    set({ ops: state.ops.map((o) => (failing.has(o.id) ? ({ ...o, status: "failed", failure } as OutboxOp) : o)) });
    if (isFinishOp(op)) {
      finishFailed(op, failure, error);
      return;
    }
    const setFailures = state.ops.filter((o) => failing.has(o.id) && o.kind !== "note").length;
    for (let i = 0; i < setFailures; i += 1) track("set_sync_failed", { status: failure.status });
    deps.onFailed?.(op, error);
    blockFinishes(error);
  }

  /** Back to the queue with 06.2's backoff, never sooner than the server's Retry-After (Spec 05.2 AC14). */
  function retryLater(op: OutboxOp, attempts: number, error: unknown): void {
    if (retryRequested) {
      // Minor 618: Retry now was tapped while this op was sending; it goes again at once, as the tap asked.
      retryRequested = false;
      retryForced = true;
      patchOp(op.id, { status: "queued", nextAttemptAt: Date.now() });
      return;
    }
    const floor = error instanceof ApiError ? (error.retryAfterMs ?? 0) : 0;
    patchOp(op.id, { status: "queued", nextAttemptAt: Date.now() + Math.max(backoffMs(attempts, random), floor) });
  }

  /**
   * Spec 06.7 AC3: the finish `PATCH`, then on `409 workout-finished` a read of the workout (with the same deadline):
   * not ended → fail; ended at our `endedAt` (to the millisecond) → `ours`; at another → `elsewhere`. A read that
   * can be retried retries the finish; any other read failure (a `404`: the workout is gone) fails it.
   */
  async function sendFinish(op: FinishOp, attempts: number): Promise<void> {
    let conflict: unknown;
    try {
      const updated = await attempt((options) => need(rest.finish)(op.workoutId, op.body, options));
      landFinish(op, { outcome: "landed", updated });
      return;
    } catch (error) {
      const verdict = classify("finish", error);
      if (verdict === "retry") return retryLater(op, attempts, error);
      if (verdict !== "reconcile") return fail(op, failureOf(error), error);
      conflict = error;
    }
    let read: WorkoutDetail;
    try {
      read = await attempt((options) => need(rest.getById)(op.workoutId, options));
    } catch (error) {
      if (classify("finish", error) === "retry") return retryLater(op, attempts, error);
      return fail(op, failureOf(error), error);
    }
    if (read.endedAt === null) return fail(op, failureOf(conflict), conflict);
    const ours = Date.parse(read.endedAt) === Date.parse(op.body.endedAt);
    landFinish(op, { outcome: ours ? "ours" : "elsewhere", detail: read });
  }

  async function send(op: OutboxOp): Promise<void> {
    const attempts = op.attempts + 1;
    patchOp(op.id, { status: "sending", attempted: true, attempts });
    if (isFinishOp(op)) return sendFinish(op, attempts);
    try {
      succeed(op, await attempt((options) => call(op, options)));
    } catch (error) {
      if (error instanceof UnresolvedTarget) {
        fail(op, { status: 0, type: "unresolved", requestId: null }, error);
        return;
      }
      const verdict = classify(op.kind, error, { finishWaiting: hasFinish(op.workoutId) });
      if (verdict === "done") succeed(op, null, true);
      else if (verdict === "retry") retryLater(op, attempts, error);
      else fail(op, failureOf(error), error);
    }
  }

  /**
   * Spec 06.7 AC2: an op that may go now. A finish may go only when no other op of its workout is left in the queue,
   * which also keeps the live-workout shortcut below from picking it ahead of its own sets.
   */
  const sendable = (o: OutboxOp) =>
    o.status !== "failed" && (!isFinishOp(o) || !state.ops.some((other) => other.id !== o.id && other.workoutId === o.workoutId));

  /**
   * The op to send next: the oldest (AC4), except that while it belongs to another workout and is backing off,
   * the live workout's oldest op may go first (deferred minor 6) — each workout's own ops stay in order, and
   * nothing is failed for it. `wait` is how long until the chosen op may go.
   */
  function nextOp(): { op: OutboxOp; wait: number } | null {
    const queue = state.ops.filter(sendable);
    const head = queue[0];
    if (!head) return null;
    const now = Date.now();
    const headWait = head.nextAttemptAt - now;
    const active = deps.activeWorkoutId?.();
    if (headWait <= 0 || !active || head.workoutId === active) return { op: head, wait: headWait };
    const live = queue.find((o) => o.workoutId === active);
    if (!live) return { op: head, wait: headWait };
    const liveWait = live.nextAttemptAt - now;
    return liveWait < headWait ? { op: live, wait: liveWait } : { op: head, wait: headWait };
  }

  /** One loop, one op in flight, oldest first (AC4). `force` makes one attempt even offline (Retry now). */
  async function drain({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (draining || stopped || state.conflict) return;
    draining = true;
    let forced = force;
    try {
      blockFinishes(null);
      for (;;) {
        const next = nextOp();
        if (!next) return;
        const { op, wait } = next;
        if (!forced && !isOnline()) return;
        if (!forced && wait > 0) {
          schedule(wait);
          return;
        }
        forced = false;
        await send(op);
        // Minor 618: the flag belongs to the send it was tapped during, whatever its outcome.
        retryRequested = false;
        if (retryForced) {
          retryForced = false;
          forced = true;
        }
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
    enqueueRound: (input) => enqueue({ ...sectionOpBase(input), kind: "round", round: input.round, body: input.body }),
    enqueueResult: (input) => enqueue({ ...sectionOpBase(input), kind: "result", body: input.body }),
    enqueueFinish: (input) => {
      const existing = state.ops.find((o): o is FinishOp => isFinishOp(o) && o.workoutId === input.workoutId);
      if (existing && existing.status !== "failed") return existing.id;
      const now = Date.now();
      const op: FinishOp = {
        id: newId(),
        workoutId: input.workoutId,
        userId,
        status: "queued",
        attempted: false,
        attempts: 0,
        nextAttemptAt: now,
        enqueuedAt: now,
        kind: "finish",
        body: input.body,
        meta: input.meta,
      };
      OutboxOpSchema.parse(op); // minor 614: throws before anything is written
      // A failed finish is replaced: the new op goes to the end of the queue, after everything else of the workout.
      set({ ops: [...state.ops.filter((o) => o !== existing), op] });
      blockFinishes(null);
      void drain();
      return op.id;
    },
    whenFinishSettles: (opId, ms) => {
      if (landedFinishes.has(opId)) return Promise.resolve("landed");
      const op = state.ops.find((o) => o.id === opId);
      if (!op || !isFinishOp(op) || op.status === "failed") return Promise.resolve("pending");
      return new Promise((resolve) => {
        let waiting = finishWaiters.get(opId);
        if (!waiting) finishWaiters.set(opId, (waiting = new Set()));
        const done = (result: "landed" | "pending") => {
          clearTimeout(timeout);
          waiting.delete(done);
          resolve(result);
        };
        const timeout = setTimeout(() => done("pending"), ms);
        waiting.add(done);
      });
    },
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
      // Only a set op has a target: a note or a timer entry has none (Spec 10.7 AC39).
      const target = isSetOp(op) ? op.target : null;
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
      // Spec 06.7 AC7: a workout with a finish op (any status) keeps every op and id-map entry; only landing,
      // dropWorkout or its Discard take them away.
      const finishing = new Set(state.ops.filter(isFinishOp).map((o) => o.workoutId));
      const kept = (workoutId: string) => workoutId === activeWorkoutId || finishing.has(workoutId);
      const ops = state.ops.filter((o) => kept(o.workoutId) || o.status !== "failed");
      const targeted = new Set(ops.flatMap((o) => (isSetOp(o) && "clientGeneratedId" in o.target ? [o.target.clientGeneratedId] : [])));
      const idMap = Object.fromEntries(Object.entries(state.idMap).filter(([key, e]) => kept(e.workoutId) || targeted.has(key)));
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
      if (draining) retryRequested = true;
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
      const unwatch = watchExternalWrites(key, () => {
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
