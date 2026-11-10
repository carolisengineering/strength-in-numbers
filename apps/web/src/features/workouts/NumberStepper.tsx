import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
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
  /** Spec 17.8 AC3: the buttons' visible text, their step ("−5", "+5"); built by `stepText`. */
  decreaseText: string;
  increaseText: string;
  /** Spec 17.8 AC4: each name starts with its visible text ("−5 lb, decrease weight for Bench"); built by `stepName`. */
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
 * Spec 17.8 AC1–AC3: the label sits above one grid row that holds the buttons and the input, so the buttons are
 * centered on the number by structure (D2), and each button shows its step as text, not an icon (D1).
 */
export function NumberStepper({ id, label, unit, value, inputMode, error, decreaseText, increaseText, decreaseLabel, increaseLabel, canDecrease, canIncrease, onChange, onDecrease, onIncrease }: NumberStepperProps) {
  return (
    // Named only when it carries a unit ("Weight · lb"): a unitless group named like its input ("Reps") would give
    // two controls the same name. The ± buttons are named on their own either way.
    <div role="group" {...(unit ? { "aria-label": `${label} · ${unit}` } : {})} className={styles.stepper}>
      <Field id={id} label={label} error={error}>
        {(control) => (
          <>
            <div className={styles.row} data-stepper-row>
              <Button variant="secondary" className={styles.step} aria-label={decreaseLabel} disabled={!canDecrease} onClick={onDecrease}>
                {decreaseText}
              </Button>
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
              <Button variant="secondary" className={styles.step} aria-label={increaseLabel} disabled={!canIncrease} onClick={onIncrease}>
                {increaseText}
              </Button>
            </div>
            {/* Always present, so two steppers side by side line up on their inputs; empty for reps. */}
            <span className={styles.unit} aria-hidden="true">
              {unit ?? " "}
            </span>
          </>
        )}
      </Field>
    </div>
  );
}
