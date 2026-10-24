import type { ButtonHTMLAttributes } from "react";

import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * An in-flight action (a save, a login redirect). Sets `aria-busy` and
   * disables the control so a double-tap cannot fire twice (AC9).
   */
  busy?: boolean;
  /** Full-width — the thumb-zone default for a form's primary action. */
  block?: boolean;
}

/**
 * The one button (Spec 04.1 §1, AC9). Native `<button>` underneath, so
 * keyboard / form semantics are free; `type` defaults to `"button"` because
 * an accidental submit is the worse failure mode. Sized to
 * `--tap-target-min` in every variant.
 */
export function Button({
  variant = "primary",
  busy = false,
  block = false,
  disabled,
  type = "button",
  className,
  children,
  "aria-busy": ariaBusy,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], block ? styles.block : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || busy}
      // `busy` also disables; a caller that must keep focus while in flight (Spec 06.1's Log set)
      // passes `aria-busy` itself and guards the double tap in its own handler.
      aria-busy={busy || ariaBusy || undefined}
    >
      {children}
    </button>
  );
}
