import { Field } from "../../ui/Field";
import { digitsToText, nextDigits } from "./clockDigits";
import styles from "./sectionTimer.module.css";
import { CLOCK_HINT } from "./timerCopy";

export interface ClockFieldProps {
  id: string;
  label: string;
  /**
   * A second hint sentence after the clock hint (the Cap field's For Time line). `null`: no hint of its own, for a
   * field in a group that says the clock hint once (Spec 17.10 AC13); pass the group's hint id as `describedBy`.
   */
  hint?: string | null;
  /** Spec 17.10 AC13: an element id that describes this field too (a group's hint), named before its error. */
  describedBy?: string;
  digits: string;
  error?: string;
  onChange(digits: string): void;
  onBlur?(): void;
}

/**
 * Spec 10.7 AC1–AC3: a minutes-and-seconds field whose digits fill from the right (`341` is 3:41). Every change —
 * typing, Backspace, paste — goes through `nextDigits`, so the caller only ever holds digits.
 */
export function ClockField({ id, label, hint, describedBy, digits, error, onChange, onBlur }: ClockFieldProps) {
  const ownHint = hint === null ? undefined : hint ? `${CLOCK_HINT} ${hint}` : CLOCK_HINT;
  return (
    <Field id={id} label={label} hint={ownHint} error={error}>
      {(control) => (
        <input
          {...control}
          aria-describedby={[describedBy, control["aria-describedby"]].filter(Boolean).join(" ") || undefined}
          className={styles.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={digitsToText(digits)}
          onChange={(event) => {
            // Minor 537: a keystroke `nextDigits` refuses (a sixth digit) isn't an edit, so it can't hide a message.
            // The input is controlled, so React puts the shown value back.
            const next = nextDigits(digits, event.target.value);
            if (next !== digits) onChange(next);
          }}
          onBlur={onBlur}
        />
      )}
    </Field>
  );
}
