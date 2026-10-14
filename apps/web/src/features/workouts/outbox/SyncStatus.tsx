import { Button } from "../../../ui/Button";
import styles from "./SyncStatus.module.css";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "2 sets", "1 note" or "2 sets and 1 note" — sets-only reads exactly as in Spec 06.2. */
const what = (sets: number, notes: number) =>
  [sets > 0 ? count(sets, "set", "sets") : null, notes > 0 ? count(notes, "note", "notes") : null].filter(Boolean).join(" and ");

export interface SyncStatusProps {
  pending: number;
  failed: number;
  /** Spec 10.3: exercises whose note is queued / failed. Optional: absent = 0 and the output is today's. */
  pendingNotes?: number;
  failedNotes?: number;
  online: boolean;
  onRetry: () => void;
  onDiscardFailed: () => void;
  /** Scroll to the first failed row; `null` when none is on screen. */
  onShowFailed: (() => void) | null;
}

/** What is not saved yet (Spec 06.2 AC15; notes: Spec 10.3 AC29). A polite live region: it announces changes of state. */
export function SyncStatus({ pending, failed, pendingNotes = 0, failedNotes = 0, online, onRetry, onDiscardFailed, onShowFailed }: SyncStatusProps) {
  if (pending === 0 && failed === 0 && pendingNotes === 0 && failedNotes === 0) return null;
  return (
    <div className={styles.status} data-testid="sync-status" role="status" aria-live="polite">
      {failed > 0 || failedNotes > 0 ? (
        <p className={styles.line}>
          <span className={styles.failed}>{what(failed, failedNotes)} couldn't be saved</span>
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
      {pending > 0 || pendingNotes > 0 ? (
        online ? (
          <p className={styles.line}>
            <span>Saving {what(pending, pendingNotes)}…</span>
            <Button variant="secondary" onClick={onRetry}>
              Retry now
            </Button>
          </p>
        ) : (
          <p className={styles.line}>Offline — {what(pending, pendingNotes)} will save when you're back online</p>
        )
      ) : null}
    </div>
  );
}
