import { useId } from "react";
import { useLocation, useNavigate } from "react-router";
import { summaryEntryState } from "./summaryEntry";
import { Button } from "../../ui/Button";
import { formatStartedAt } from "./format";
import { KEEP_OPEN, WAITING_OFFLINE, WAITING_ONLINE, waitingTitle } from "./messages";
import { useOutbox, useOutboxState } from "./outbox/OutboxContext";
import type { FinishOp } from "./outbox/ops";
import styles from "./WaitingFinishCard.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Spec 06.7 AC26, §5.3: a finished workout saved on this phone, waiting to send. Built from the op alone (its `meta`),
 * so it renders before — and without — the active read. The status is a polite region whose text changes only with
 * the state (signal, durable), never on each retry.
 */
export function WaitingFinishCard({ op }: { op: FinishOp }) {
  const outbox = useOutbox();
  const { online, durable } = useOutboxState();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const headingId = useId();
  const status = [online ? WAITING_ONLINE : WAITING_OFFLINE, durable ? null : KEEP_OPEN].filter((t) => t !== null).join(" ");
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h2 className={styles.title} id={headingId}>
        {waitingTitle(1)}
      </h2>
      <p className={styles.meta}>
        Started {formatStartedAt(op.meta.startedAt)} · {plural(op.meta.exerciseCount, "exercise", "exercises")} · {plural(op.meta.setCount, "set", "sets")}
      </p>
      <p className={styles.status} role="status">
        {status}
      </p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void navigate(`/app/workouts/${op.workoutId}`, { state: summaryEntryState(pathname, "/app/workouts") })}>
          View workout
        </Button>
        <Button variant="secondary" onClick={() => outbox?.retryNow()}>
          Retry now
        </Button>
      </div>
    </section>
  );
}
