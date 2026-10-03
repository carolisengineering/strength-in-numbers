import { Button } from "../../../ui/Button";
import styles from "./SyncStatus.module.css";

const sets = (n: number) => `${n} ${n === 1 ? "set" : "sets"}`;

export interface SyncStatusProps {
  pending: number;
  failed: number;
  online: boolean;
  onRetry: () => void;
  onDiscardFailed: () => void;
  /** Scroll to the first failed row; `null` when none is on screen. */
  onShowFailed: (() => void) | null;
}

/** What is not saved yet (Spec 06.2 AC15). A polite live region: it announces changes of state. */
export function SyncStatus({ pending, failed, online, onRetry, onDiscardFailed, onShowFailed }: SyncStatusProps) {
  if (pending === 0 && failed === 0) return null;
  return (
    <div className={styles.status} data-testid="sync-status" role="status" aria-live="polite">
      {failed > 0 ? (
        <p className={styles.line}>
          <span className={styles.failed}>{sets(failed)} couldn't be saved</span>
          {onShowFailed ? (
            <Button variant="secondary" onClick={onShowFailed}>
              Show
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onDiscardFailed}>
            Discard
          </Button>
        </p>
      ) : null}
      {pending > 0 ? (
        online ? (
          <p className={styles.line}>
            <span>Saving {sets(pending)}…</span>
            <Button variant="secondary" onClick={onRetry}>
              Retry now
            </Button>
          </p>
        ) : (
          <p className={styles.line}>Offline — {sets(pending)} will save when you're back online</p>
        )
      ) : null}
    </div>
  );
}
