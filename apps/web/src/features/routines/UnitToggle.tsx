import type { WeightUnit } from "@sin/core";
import { Button } from "../../ui/Button";
import styles from "./UnitToggle.module.css";

const UNITS: readonly WeightUnit[] = ["kg", "lb"];

/**
 * kg / lb as a labeled group of pressed-state buttons (Spec 10.2 AC10, AC13, D3). `"mixed"` presses neither:
 * rows loaded in different units must not look like they agree.
 */
export function UnitToggle({ label, value, onChange }: { label: string; value: WeightUnit | "mixed"; onChange: (unit: WeightUnit) => void }) {
  return (
    <div role="group" aria-label={label} className={styles.group}>
      {UNITS.map((unit) => (
        <Button
          key={unit}
          variant="secondary"
          aria-pressed={value === unit}
          className={value === unit ? styles.pressed : undefined}
          onClick={() => onChange(unit)}
        >
          {unit}
        </Button>
      ))}
    </div>
  );
}
