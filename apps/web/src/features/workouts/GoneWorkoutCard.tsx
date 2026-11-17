import { useId, useState } from "react";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { GONE_BODY, GONE_CONFIRM, GONE_DISCARD, GONE_TITLE } from "./messages";
import { useDiscardUnsentWorkout } from "./useWorkoutMutations";
import styles from "./WaitingFinishCard.module.css";

/**
 * Spec 06.7 AC30, §5.4: the server refused the finish and no longer has the workout live (a `404`, or another or no
 * active workout). The only place a finished workout can be thrown away from the phone, behind a confirm.
 */
export function GoneWorkoutCard({ workoutId }: { workoutId: string }) {
  const discard = useDiscardUnsentWorkout();
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h2 className={styles.title} id={headingId}>
        {GONE_TITLE}
      </h2>
      <p className={styles.meta}>{GONE_BODY}</p>
      <div className={styles.actions}>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          {GONE_DISCARD}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={GONE_CONFIRM}
        confirmLabel="Discard"
        variant="danger"
        onConfirm={() => {
          setConfirming(false);
          discard(workoutId);
        }}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
