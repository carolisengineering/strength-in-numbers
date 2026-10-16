/** Spec 06.5 D7: a first guess for a flaky gym connection; tunable after the phone week (O3). */
export const SYNC_WAIT_MS = 8000;

export type GuardPhase = "idle" | "syncing" | "warning";
export interface Unsaved {
  sets: number;
  notes: number;
}
export interface GuardState {
  phase: GuardPhase;
  unsaved: Unsaved;
}

/** The slice of the 06.2 `Outbox` the guard reads. */
export interface GuardOutbox {
  getState(): { ops: readonly { kind: string; status: string }[]; online: boolean; conflict: boolean };
  subscribe(listener: () => void): () => void;
  retryNow(): void;
}

export interface LogoutGuard {
  /** The Sign out tap. */
  request(): void;
  /** "Sign out anyway": only meaningful in the warning. */
  confirm(): void;
  /** Cancel (syncing) and Stay (warning). */
  cancel(): void;
  subscribe(listener: () => void): () => void;
  getState(): GuardState;
}

const IDLE: GuardState = { phase: "idle", unsaved: { sets: 0, notes: 0 } };

/**
 * The sign-out state machine (Spec 06.5 §6.5): `idle → syncing → warning`. React-free; tests drive it
 * with a fake outbox and fake timers. "Unsaved" is every op still in the outbox (queued, sending or
 * failed): the outbox only ever holds the signed-in user's ops (06.2 AC8).
 */
export function createLogoutGuard(deps: { outbox: GuardOutbox; proceed: () => void; waitMs?: number }): LogoutGuard {
  const { outbox, proceed } = deps;
  const waitMs = deps.waitMs ?? SYNC_WAIT_MS;
  let state: GuardState = IDLE;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unwatch: (() => void) | null = null;
  let finished = false;
  const listeners = new Set<() => void>();

  const emit = (next: GuardState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  function count(): Unsaved {
    const ops = outbox.getState().ops;
    const notes = ops.filter((o) => o.kind === "note").length;
    return { sets: ops.length - notes, notes };
  }
  const total = (u: Unsaved) => u.sets + u.notes;

  function canSync(): boolean {
    const s = outbox.getState();
    return s.online && !s.conflict && s.ops.some((o) => o.status !== "failed");
  }

  function stopWatching(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    unwatch?.();
    unwatch = null;
  }

  function finish(): void {
    stopWatching();
    finished = true;
    emit(IDLE);
    proceed();
  }

  function warn(unsaved: Unsaved): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    unwatch ??= outbox.subscribe(onOutboxChange);
    emit({ phase: "warning", unsaved });
  }

  /** Every move toward `proceed` re-reads the outbox once more (AC18c). Returns true when it left the phase. */
  function settleIfEmpty(): boolean {
    if (total(count()) !== 0) return false;
    const again = count();
    if (total(again) === 0) finish();
    else warn(again);
    return true;
  }

  function onOutboxChange(): void {
    if (finished || state.phase === "idle") return;
    if (settleIfEmpty()) return;
    const unsaved = count();
    if (state.phase === "syncing" && !canSync()) warn(unsaved); // nothing left that waiting could send
    else emit({ phase: state.phase, unsaved });
  }

  function onWaitElapsed(): void {
    timer = null;
    if (finished || state.phase !== "syncing") return;
    if (settleIfEmpty()) return;
    warn(count());
  }

  return {
    request: () => {
      if (finished || state.phase !== "idle") return; // AC18a
      if (settleIfEmpty()) return;
      const unsaved = count();
      if (!canSync()) {
        warn(unsaved);
        return;
      }
      emit({ phase: "syncing", unsaved });
      unwatch = outbox.subscribe(onOutboxChange);
      timer = setTimeout(onWaitElapsed, waitMs);
      outbox.retryNow();
    },
    confirm: () => {
      if (finished || state.phase !== "warning") return;
      finish();
    },
    cancel: () => {
      if (finished || state.phase === "idle") return;
      stopWatching();
      emit(IDLE);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,
  };
}
