import { formatClock } from "@sin/core";
import { remainingSeconds } from "./restTimer";
import styles from "./RestReadout.module.css";
import { useNow } from "./useNow";
import { useRestTimer } from "./useRestTimer";

/**
 * Spec 17.1 AC44: "Rest 1:42" in the current-set panel's label row, "Ready" at zero until the next log. `role="timer"`
 * has no live announcement, so a screen reader is not told every second (AC48; RestLine says "Rest over" once).
 * Spec 17.8 AC7–AC8: the clock is a figure with "Rest" as a smaller caption inside the same element, so its text is
 * still "Rest 1:42"; at zero "Ready" sits on a filled teal ground, a state change, not an animation.
 */
export function RestReadout({ workoutId }: { workoutId: string }) {
  const { timer, now } = useRestTimer(workoutId);
  const t = useNow(1000, timer !== null && remainingSeconds(timer, now()) > 0, now);
  if (timer === null) return null;
  const left = remainingSeconds(timer, t);
  return left > 0 ? (
    <p className={styles.readout} role="timer" data-state="running">
      <span className={styles.caption}>Rest</span> {formatClock(left)}
    </p>
  ) : (
    <p className={`${styles.readout} ${styles.ready}`} role="timer" data-state="ready">
      Ready
    </p>
  );
}
