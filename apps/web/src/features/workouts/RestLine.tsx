import { useEffect, useRef, useState } from "react";

import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { remainingSeconds } from "./restTimer";
import styles from "./RestLine.module.css";
import { useNow } from "./useNow";
import { useRestTimer } from "./useRestTimer";

/**
 * Spec 17.1 AC44 / AC48: a 3 px line across the top of the workout screen that fills over the rest and disappears at
 * zero, plus the one polite "Rest over". The fill is a native `<progress>`: the CSP forbids inline style, so no width or
 * transform can be set from here. The slot is always mounted, so a rest starting or ending never moves the page.
 * "Rest over" is said only when a running timer reaches zero, never when a log clears it.
 */
export function RestLine({ workoutId }: { workoutId: string }) {
  const { timer, now } = useRestTimer(workoutId);
  const t = useNow(1000, timer !== null && remainingSeconds(timer, now()) > 0, now);
  const left = remainingSeconds(timer, t);
  const running = useRef(false);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (timer === null) {
      running.current = false;
      return;
    }
    if (left > 0) {
      running.current = true;
      setSaid("");
    } else if (running.current) {
      running.current = false;
      setSaid("Rest over");
    }
  }, [timer, left]);
  // The status sits outside the aria-hidden slot: a live region under aria-hidden is never announced.
  return (
    <>
      <div className={styles.slot} aria-hidden="true" data-testid="rest-line-slot">
        {timer !== null && left > 0 ? (
          <progress className={styles.fill} data-testid="rest-line-fill" value={timer.durationS - left} max={timer.durationS} />
        ) : null}
      </div>
      <VisuallyHidden>
        <span role="status">{said}</span>
      </VisuallyHidden>
    </>
  );
}
