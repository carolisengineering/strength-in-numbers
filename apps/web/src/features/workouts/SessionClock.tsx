import { useEffect, useState } from "react";

import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { formatDuration } from "./format";
import styles from "./SessionClock.module.css";

/**
 * Spec 17.1 AC31: time since `startedAt`, derived from the clock on every render (never counted), clamped at 0:00 when
 * the device clock is behind the server's. The tick only re-renders this component. Not a live region. Phase C
 * replaces the interval with the shared `useNow`.
 */
export function SessionClock({ startedAt, now = Date.now }: { startedAt: string; now?: () => number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now() - Date.parse(startedAt)) / 1000));
  return (
    <p className={styles.clock}>
      <VisuallyHidden>Elapsed </VisuallyHidden>
      {formatDuration(seconds)}
    </p>
  );
}
