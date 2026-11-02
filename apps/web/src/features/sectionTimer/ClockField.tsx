import { Field } from "../../ui/Field";
import { digitsToText, nextDigits } from "./clockDigits";
import styles from "./sectionTimer.module.css";
import { CLOCK_HINT } from "./timerCopy";

export interface ClockFieldProps {
  id: string;
  label: string;
  /** A second hint sentence after the clock hint (the Cap field's For Time line). */
  hint?: string;
  digits: string;
  error?: string;
  onChange(digits: string): void;
  onBlur?(): void;
}

/**
 * Spec 10.7 AC1–AC3: a minutes-and-seconds field whose digits fill from the right (`341` is 3:41). Every change —
 * typing, Backspace, paste — goes through `nextDigits`, so the caller only ever holds digits.
 */
export function ClockField({ id, label, hint, digits, error, onChange, onBlur }: ClockFieldProps) {
  return (
    <Field id={id} label={label} hint={hint ? `${CLOCK_HINT} ${hint}` : CLOCK_HINT} error={error}>
      {(control) => (
        <input
          {...control}
          className={styles.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={digitsToText(digits)}
          onChange={(event) => onChange(nextDigits(digits, event.target.value))}
          onBlur={onBlur}
        />
      )}
    </Field>
  );
}
