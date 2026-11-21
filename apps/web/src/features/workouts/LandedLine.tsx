import { useEffect, useSyncExternalStore } from "react";
import { Button } from "../../ui/Button";
import { TextLink } from "../../ui/TextLink";
import { landedLine } from "./messages";
import { useLandedStore } from "./outbox/LandedStoreContext";
import type { LandedStore } from "./outbox/landedStore";
import { markLandedShown } from "./useLandedLeave";
import styles from "./WaitingFinishCard.module.css";

const NONE: readonly never[] = [];
const noSubscribe = () => () => {};

/**
 * Spec 06.7 AC27, AC28, §6.9, D12, D18: the one-time "saved" line above the Start screen — a workout that landed while
 * its summary wasn't open. The newest entry, as a link to its summary (which removes it when it opens); Dismiss
 * removes it, and so does leaving the screen it was shown on: a route change after which the line isn't drawn
 * (`useLandedLeave`, minors 636, 668), never an unmount by itself. `ours` / `elsewhere` carry no count.
 */
export function LandedLine() {
  const store = useLandedStore();
  const items = useSyncExternalStore(store ? store.subscribe : noSubscribe, store ? store.list : () => NONE);
  const item = items[0];
  const shownId = item?.workoutId ?? null;
  useEffect(() => (store === null || shownId === null ? undefined : markLandedShown(store, shownId)), [store, shownId]);
  if (!item) return null;
  return (
    <div className={styles.landed}>
      <TextLink to={`/app/workouts/${item.workoutId}`}>{landedLine(item.how === "landed" ? item.lifts : null)}</TextLink>
      <Button variant="secondary" onClick={() => (store as LandedStore).remove(item.workoutId)}>
        Dismiss
      </Button>
    </div>
  );
}
