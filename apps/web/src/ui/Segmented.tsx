import { useId } from "react";

import styles from "./Segmented.module.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  /** The radios' shared `name`: unique per strip, so two strips on one screen never share a group. */
  name: string;
  legend: string;
  options: readonly SegmentedOption<T>[];
  /** `null` checks nothing (a routine plan's "mixed" units, Spec 10.2 AC13). */
  value: T | null;
  onChange: (value: T) => void;
  hint?: string | undefined;
  /** Shown with `role="alert"` and named by the group's `aria-describedby` (`aria-invalid` isn't allowed on a group). */
  error?: string | undefined;
  disabled?: boolean | undefined;
}

/**
 * 2–4 fixed choices compared at a glance (Spec 17.7 AC1, §6.1): a fieldset, its legend, one native radio per
 * option. The radios give arrow keys, one Tab stop and screen-reader behavior for free; the checked option is filled
 * and checked, never marked by color alone. Four options sit four across or 2 × 2, never 3 + 1 (AC2).
 */
export function Segmented<T extends string>({ name, legend, options, value, onChange, hint, error, disabled }: SegmentedProps<T>) {
  const base = useId();
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <fieldset
      className={styles.fieldset}
      aria-describedby={describedBy}
      disabled={disabled}
      // A browser submits a form on Enter from a radio; a select never did. Enter here chooses, it never saves a sheet.
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "radio") event.preventDefault();
      }}
    >
      <legend className={styles.legend}>{legend}</legend>
      <div className={options.length === 4 ? `${styles.options} ${styles.four}` : styles.options}>
        {options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              className={styles.radio}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
