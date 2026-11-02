import { TIMER_FORMAT_VALUES } from "@sin/core";
import { useState } from "react";
import { Field } from "../../ui/Field";
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
import { withFormat, type TimerFieldErrors, type TimerFieldsValue, type TimerFormatChoice } from "./timerFields";

export interface TimerFieldsProps {
  idPrefix: string;
  value: TimerFieldsValue;
  /** Errors from Done or from the server; the seconds error also shows once its field has been left. */
  errors?: TimerFieldErrors;
  onChange(value: TimerFieldsValue): void;
}

const CHOICES: readonly TimerFormatChoice[] = ["none", ...TIMER_FORMAT_VALUES];
const ROUNDS_DIGITS_MAX = 3;
const secondsOver59 = (digits: string) => digits !== "" && digitsToSeconds(digits) === null;

/**
 * Spec 10.7 AC4–AC5: the Timer group — a `Timer` select (None / Set Timer / AMRAP / Time Cap), then the chosen
 * format's fields. `Seconds go up to 59.` never flashes mid-entry: it shows once the field is left (or after Done),
 * and only while the digits still say it.
 */
export function TimerFields({ idPrefix, value, errors = {}, onChange }: TimerFieldsProps) {
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
      onChange={(digits) => onChange({ ...value, [key]: digits })}
      onBlur={() => setLeft((l) => ({ ...l, [key]: true }))}
    />
  );

  return (
    <div className={styles.group}>
      <Field id={`${idPrefix}-format`} label={TIMER_LABEL}>
        {(control) => (
          <select
            {...control}
            className={styles.select}
            value={value.format}
            onChange={(event) => {
              setLeft({});
              onChange(withFormat(value, event.target.value as TimerFormatChoice));
            }}
          >
            {CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {TIMER_FORMAT_LABELS[choice]}
              </option>
            ))}
          </select>
        )}
      </Field>
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
                onChange={(event) => onChange({ ...value, rounds: event.target.value.replace(/\D/g, "").slice(0, ROUNDS_DIGITS_MAX) })}
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
}
