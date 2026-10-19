import { useId, useState } from "react";

import { readKeepAwake, setKeepAwake, wakeLockSupported } from "../../ui/keepAwake";
import styles from "./KeepAwakeSetting.module.css";

/**
 * "Keep screen on during workouts" (#108). Like Theme, a per-device setting: it applies at the next workout
 * screen, is stored on this device only, and has no Save button. Where the browser cannot keep the screen on,
 * the box is disabled and says so rather than appearing to work.
 */
export function KeepAwakeSetting() {
  const supported = wakeLockSupported();
  const [on, setOn] = useState(() => readKeepAwake());
  const hintId = useId();

  function toggle() {
    setOn(!on);
    setKeepAwake(!on);
  }

  return (
    <div className={styles.setting}>
      <label className={styles.row}>
        <input type="checkbox" className={styles.box} checked={supported && on} disabled={!supported} aria-describedby={hintId} onChange={toggle} />
        <span>Keep screen on during workouts</span>
      </label>
      <p id={hintId} className={styles.hint}>
        {supported ? "Applies on this device." : "Not available in this browser."}
      </p>
    </div>
  );
}
