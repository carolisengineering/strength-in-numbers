import type { ReactNode } from "react";

import styles from "./Field.module.css";

/**
 * The attributes a form control must carry to be wired to its `<Field>`:
 * the `id` the `<label>` points at, `aria-describedby` linking the hint and
 * error text, and `aria-invalid` while an error is shown.
 */
export interface FieldControlProps {
  readonly id: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
}

export interface FieldProps {
  /** Stable id for the control; the label, hint and error ids derive from it. */
  id: string;
  label: string;
  /** Optional helper text shown under the control. */
  hint?: string;
  /** Validation message. When set it renders with `role="alert"` (AC9). */
  error?: string;
  /**
   * The control itself, as a function so the field can hand it the
   * attributes it must carry. Read like a backend middleware: `<Field>` owns
   * the label + messages, and injects the wiring; the caller still owns the
   * `<input>` / `<select>` and everything about it.
   *
   *   <Field id="displayName" label="Display name" error={errors.displayName}>
   *     {(control) => <input {...control} value={v} onChange={…} />}
   *   </Field>
   */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label + control + hint/error slot (Spec 04.1 §1, AC9). The label is
 * associated by `htmlFor`/`id` (tapping it focuses the control — a large
 * target on a phone), and the error is announced by screen readers via
 * `role="alert"` and reachable from the control via `aria-describedby`.
 */
export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
