import { useId } from "react";

import { setHevyAutoPush, useHevyAutoPushOn } from "../../ui/hevyAutoPush";
import { HEVY_SEND_COPY } from "./send/messages";
import { useHevyKey } from "./useHevyKey";
import styles from "./AutoPushSetting.module.css";

/**
 * Spec 20.2 AC23: "Send each workout to Hevy when I finish it". A per-device setting like Keep screen on: stored on
 * this device only, no Save button. Shown only with a key on this device (the screen itself is the owner's). It follows
 * a change made in another tab (minor 264).
 */
export function AutoPushSetting() {
  const { hasKey } = useHevyKey();
  const on = useHevyAutoPushOn();
  const helpId = useId();

  if (!hasKey) return null;

  function toggle() {
    setHevyAutoPush(!on);
  }

  return (
    <div className={styles.setting}>
      <label className={styles.row}>
        <input type="checkbox" className={styles.box} checked={on} aria-describedby={helpId} onChange={toggle} />
        <span>{HEVY_SEND_COPY.autoPushLabel}</span>
      </label>
      <p id={helpId} className={styles.hint}>
        {HEVY_SEND_COPY.autoPushHelp}
      </p>
    </div>
  );
}
