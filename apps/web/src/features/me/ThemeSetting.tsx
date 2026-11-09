import { useId, useState } from "react";

import { Segmented } from "../../ui/Segmented";
import { readThemePreference, setThemePreference, type ThemePreference } from "../../ui/theme";

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * Light / Dark / System (Spec 17.0 §5.4, AC21–AC22). A per-device display setting: it applies instantly and
 * is stored on this device only, so it has no Save button and never touches `/v1/me`. Drawn by the shared
 * `Segmented` (Spec 17.7 AC8), which this strip was the model for.
 */
export function ThemeSetting() {
  const [value, setValue] = useState<ThemePreference>(() => readThemePreference());
  const name = useId();

  function choose(next: ThemePreference) {
    setValue(next);
    setThemePreference(next);
  }

  return <Segmented name={name} legend="Theme" options={OPTIONS} value={value} onChange={choose} hint="Applies on this device." />;
}
