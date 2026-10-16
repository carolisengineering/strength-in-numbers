import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";

import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { createLogoutGuard, type GuardState } from "./logoutGuard";
import { MESSAGES, unsavedMessage } from "./messages";
import { useOutbox } from "./outbox/OutboxContext";
import styles from "./useLogoutGuard.module.css";

const IDLE: GuardState = { phase: "idle", unsaved: { sets: 0, notes: 0 } };
const noSubscribe = () => () => {};
const idleState = () => IDLE;

export interface LogoutGuardDialogProps {
  state: GuardState;
  onCancel: () => void;
  onConfirm: () => void;
}

/** One `ConfirmDialog` whose props follow the phase, so syncing → warning happens in place (Spec 06.5 §6.7). */
export function LogoutGuardDialog({ state, onCancel, onConfirm }: LogoutGuardDialogProps) {
  const syncing = state.phase === "syncing";
  return (
    <ConfirmDialog
      open={state.phase !== "idle"}
      title={syncing ? MESSAGES.syncingTitle : MESSAGES.warningTitle}
      confirmLabel={MESSAGES.signOutAnyway}
      cancelLabel={syncing ? MESSAGES.cancel : MESSAGES.stay}
      variant="danger"
      confirmDisabled={syncing}
      focusKey={state.phase}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {/* Inline, not the page-level Spinner (min-height 100dvh): the dialog must stay a small sheet so Cancel stays in reach. */}
      <div role="status">
        {syncing ? (
          <p className={styles.saving}>
            <span className={styles.ring} aria-hidden="true" />
            {MESSAGES.syncingBody}
          </p>
        ) : (
          <p>{unsavedMessage(state.unsaved)}</p>
        )}
      </div>
    </ConfirmDialog>
  );
}

/**
 * Wraps a "sign out now" function with the Spec 06.5 guard. Lives in `features/workouts` because the
 * outbox does; `ProfileScreen` composes it with the unchanged `useSession().logout` (D6). Where no
 * outbox is mounted it just calls `proceed`.
 */
export function useLogoutGuard(proceed: () => void): { request: () => void; dialog: ReactNode } {
  const outbox = useOutbox();
  const proceedRef = useRef(proceed);
  useEffect(() => {
    proceedRef.current = proceed;
  });
  const guard = useMemo(
    () => (outbox ? createLogoutGuard({ outbox, proceed: () => proceedRef.current() }) : null),
    [outbox],
  );
  const state = useSyncExternalStore(guard ? guard.subscribe : noSubscribe, guard ? guard.getState : idleState);
  useEffect(() => () => guard?.cancel(), [guard]);

  const request = useCallback(() => (guard ? guard.request() : proceedRef.current()), [guard]);
  const dialog = guard ? <LogoutGuardDialog state={state} onCancel={guard.cancel} onConfirm={guard.confirm} /> : null;
  return { request, dialog };
}
