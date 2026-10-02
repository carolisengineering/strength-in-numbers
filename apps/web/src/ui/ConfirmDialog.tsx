import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  /** The parent owns this; the dialog never closes itself. */
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for an irreversible action (discard, delete). */
  variant?: "primary" | "danger";
  /** An in-flight confirm: disables both buttons so a double-tap cannot fire twice. */
  busy?: boolean;
  onConfirm: () => void;
  /** Called by Cancel and by Escape / the Android back gesture. */
  onCancel: () => void;
}

/**
 * A small modal confirmation on the native `<dialog>` (Spec 06.1 §5, AC31, D9) — not
 * `window.confirm()`, which is blocking, unstyled and awkward on mobile. Opened with `showModal()`,
 * so the browser traps focus, makes the page behind it inert, and restores focus on close.
 *
 * Cancel comes first in DOM order and Confirm last: Confirm sits on the thumb-zone side, and the
 * safe action receives the initial focus.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const isOpen = dialog.hasAttribute("open");
    if (open && !isOpen) dialog.showModal();
    else if (!open && isOpen) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        // Controlled: tell the parent, and let it flip `open`.
        event.preventDefault();
        onCancel();
      }}
    >
      {open ? (
        <div className={styles.content}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          <div className={styles.body}>{children}</div>
          <div className={styles.actions}>
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button variant={variant} busy={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
