import { formatDuration } from "./format";
import { remainingSeconds } from "./restTimer";
import styles from "./RestReadout.module.css";
import { useNow } from "./useNow";
import { useRestTimer } from "./useRestTimer";

/**
 * Spec 17.1 AC44: "Rest 1:42" in the current-set panel's label row, "Ready" at zero until the next log. `role="timer"`
 * has no live announcement, so a screen reader is not told every second (AC48; RestLine says "Rest over" once).
 */
export function RestReadout({ workoutId }: { workoutId: string }) {
  const { timer, now } = useRestTimer(workoutId);
  const t = useNow(1000, timer !== null && remainingSeconds(timer, now()) > 0, now);
  if (timer === null) return null;
  const left = remainingSeconds(timer, t);
  return (
    <p className={styles.readout} role="timer">
      {left > 0 ? `Rest ${formatDuration(left)}` : "Ready"}
    </p>
  );
}
