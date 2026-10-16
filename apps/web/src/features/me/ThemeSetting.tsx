import { useId, useState } from "react";

import { readThemePreference, setThemePreference, type ThemePreference } from "../../ui/theme";
import styles from "./ThemeSetting.module.css";

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * Light / Dark / System (Spec 17.0 §5.4, AC21–AC22). A per-device display setting: it applies instantly and
 * is stored on this device only, so it has no Save button and never touches `/v1/me`. Native radios inside
 * labels give arrow-key and screen-reader behavior for free; the checked option is filled and checked, never
 * marked by colour alone.
 */
export function ThemeSetting() {
  const [value, setValue] = useState<ThemePreference>(() => readThemePreference());
  const name = useId();
  const hintId = useId();

  function choose(next: ThemePreference) {
    setValue(next);
    setThemePreference(next);
  }

  return (
    <fieldset className={styles.fieldset} aria-describedby={hintId}>
      <legend className={styles.legend}>Theme</legend>
      <div className={styles.options} role="radiogroup" aria-label="Theme">
        {OPTIONS.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              className={styles.radio}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => choose(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <p id={hintId} className={styles.hint}>
        Applies on this device.
      </p>
    </fieldset>
  );
}
