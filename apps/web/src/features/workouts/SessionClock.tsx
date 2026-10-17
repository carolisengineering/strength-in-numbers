import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { formatDuration } from "./format";
import styles from "./SessionClock.module.css";
import { useNow } from "./useNow";

/**
 * Spec 17.1 AC31: time since `startedAt`, derived from the clock on every render (never counted), clamped at 0:00 when
 * the device clock is behind the server's. The shared `useNow` tick re-renders only this component. Not a live region.
 */
export function SessionClock({ startedAt, now = Date.now }: { startedAt: string; now?: () => number }) {
  const t = useNow(1000, true, now);
  const seconds = Math.max(0, Math.floor((t - Date.parse(startedAt)) / 1000));
  return (
    <p className={styles.clock}>
      <VisuallyHidden>Elapsed </VisuallyHidden>
      {formatDuration(seconds)}
    </p>
  );
}
