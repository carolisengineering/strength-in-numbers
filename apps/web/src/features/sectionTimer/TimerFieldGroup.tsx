import { TIMER_FORMAT_VALUES } from "@sin/core";
import { useState } from "react";
import { Field } from "../../ui/Field";
import { Segmented } from "../../ui/Segmented";
import { digitsToSeconds } from "./clockDigits";
import { ClockField } from "./ClockField";
import styles from "./sectionTimer.module.css";
import {
  CAP_LABEL,
  FOR_TIME_HINT,
  ROUND_LENGTH_LABEL,
  ROUNDS_LABEL,
  SECONDS_MAX_ERROR,
  TIME_LIMIT_LABEL,
  TIMER_FORMAT_LABELS,
  TIMER_LABEL,
} from "./timerCopy";
import { withFormat, type TimerFieldErrors, type TimerFieldName, type TimerFieldsValue, type TimerFormatChoice } from "./timerFields";

export interface TimerFieldsProps {
  idPrefix: string;
  value: TimerFieldsValue;
  /** Errors from Done or from the server; the seconds error also shows once its field has been left. */
  errors?: TimerFieldErrors;
  onChange(value: TimerFieldsValue): void;
  /** Spec 10.7 AC40: every control disabled (the section has unsent timer entries). */
  disabled?: boolean;
  /**
   * Which message the lifter's change may clear (minors 313, 326): the field's own (`rounds`, `roundSeconds`,
   * `capSeconds`), then `group` on any timer change, so a sheet hides them without diffing timer values.
   */
  onEdit?(field: TimerFieldName | "group"): void;
}

const CHOICES: readonly { value: TimerFormatChoice; label: string }[] = (["none", ...TIMER_FORMAT_VALUES] as const).map((choice) => ({
  value: choice,
  label: TIMER_FORMAT_LABELS[choice],
}));
const ROUNDS_DIGITS_MAX = 3;
const secondsOver59 = (digits: string) => digits !== "" && digitsToSeconds(digits) === null;

/**
 * Spec 10.7 AC4–AC5: the Timer group — a `Timer` choice (None / Set Timer / AMRAP / Time Cap; a Segmented since
 * Spec 17.7), then the chosen
 * format's fields. `Seconds go up to 59.` never flashes mid-entry: it shows once the field is left (or after Done),
 * and only while the digits still say it.
 */
export function TimerFields({ idPrefix, value, errors = {}, onChange, disabled = false, onEdit }: TimerFieldsProps) {
  const edited = (field?: TimerFieldName) => {
    if (field) onEdit?.(field);
    onEdit?.("group");
  };
  const [left, setLeft] = useState<Partial<Record<"roundDigits" | "capDigits", boolean>>>({});
  const clockError = (key: "roundDigits" | "capDigits", name: "roundSeconds" | "capSeconds"): string | undefined => {
    if (secondsOver59(value[key]) && (left[key] || errors[name] === SECONDS_MAX_ERROR)) return SECONDS_MAX_ERROR;
    return errors[name] === SECONDS_MAX_ERROR ? undefined : errors[name];
  };
  const clock = (key: "roundDigits" | "capDigits", name: "roundSeconds" | "capSeconds", label: string, hint?: string) => (
    <ClockField
      id={`${idPrefix}-${name}`}
      label={label}
      hint={hint}
      digits={value[key]}
      error={clockError(key, name)}
      onChange={(digits) => {
        edited(name);
        onChange({ ...value, [key]: digits });
      }}
      onBlur={() => setLeft((l) => ({ ...l, [key]: true }))}
    />
  );

  const group = (
    <div className={styles.group}>
      <Segmented<TimerFormatChoice>
        name={`${idPrefix}-format`}
        legend={TIMER_LABEL}
        options={CHOICES}
        value={value.format}
        onChange={(format) => {
          setLeft({});
          edited();
          onChange(withFormat(value, format));
        }}
      />
      {value.format === "set_timer" ? (
        <>
          <Field id={`${idPrefix}-rounds`} label={ROUNDS_LABEL} error={errors.rounds}>
            {(control) => (
              <input
                {...control}
                className={styles.input}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={value.rounds}
                onChange={(event) => {
                  edited("rounds");
                  onChange({ ...value, rounds: event.target.value.replace(/\D/g, "").slice(0, ROUNDS_DIGITS_MAX) });
                }}
              />
            )}
          </Field>
          {clock("roundDigits", "roundSeconds", ROUND_LENGTH_LABEL)}
        </>
      ) : null}
      {value.format === "amrap" ? clock("capDigits", "capSeconds", TIME_LIMIT_LABEL) : null}
      {value.format === "time_cap" ? clock("capDigits", "capSeconds", CAP_LABEL, FOR_TIME_HINT) : null}
      {errors.group ? (
        <p className={styles.groupError} role="alert">
          {errors.group}
        </p>
      ) : null}
    </div>
  );
  // Spec 10.7 AC40: a native disabled fieldset disables every control in the group at once.
  return disabled ? (
    <fieldset className={styles.locked} disabled>
      {group}
    </fieldset>
  ) : (
    group
  );
}
