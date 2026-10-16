import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { MinusIcon, PlusIcon } from "../../ui/icons";
import styles from "./NumberStepper.module.css";

export interface NumberStepperProps {
  id: string;
  /** The input's own label ("Weight", "Reps"): tests and voice control address the field by it. */
  label: string;
  /** Shown under the number and named in the group ("Weight · lb"); omitted for reps. */
  unit?: string | undefined;
  value: string;
  inputMode: "decimal" | "numeric";
  error?: string | undefined;
  decreaseLabel: string;
  increaseLabel: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onChange: (value: string) => void;
  onDecrease: () => void;
  onIncrease: () => void;
}

/**
 * Spec 17.1 §6.4: − number +. The number stays a text input (AC20): focus selects it so typing replaces it. A button
 * at its limit is disabled, not hidden. Each tap is an ordinary edit (`onChange` → the draft's `edit` action, AC21).
 */
export function NumberStepper({ id, label, unit, value, inputMode, error, decreaseLabel, increaseLabel, canDecrease, canIncrease, onChange, onDecrease, onIncrease }: NumberStepperProps) {
  return (
    // Named only when it carries a unit ("Weight · lb"): a unitless group named like its input ("Reps") would give
    // two controls the same name. The ± buttons are named on their own either way.
    <div role="group" {...(unit ? { "aria-label": `${label} · ${unit}` } : {})} className={styles.stepper}>
      <Button variant="secondary" className={styles.step} aria-label={decreaseLabel} disabled={!canDecrease} onClick={onDecrease}>
        <MinusIcon />
      </Button>
      <div className={styles.figure}>
        <Field id={id} label={label} error={error}>
          {(control) => (
            <input
              {...control}
              className={styles.input}
              type="text"
              inputMode={inputMode}
              autoComplete="off"
              value={value}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </Field>
        {unit ? (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        ) : null}
      </div>
      <Button variant="secondary" className={styles.step} aria-label={increaseLabel} disabled={!canIncrease} onClick={onIncrease}>
        <PlusIcon />
      </Button>
    </div>
  );
}
