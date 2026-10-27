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
  /**
   * `false`: Escape does nothing and a native close (a second Escape) reopens the dialog, so work in flight stays on
   * screen (deferred minor 125; like `Sheet`'s `dismissible`). Default `true`: Spec 12's delete lets Escape close it.
   */
  dismissible?: boolean;
  /** Disables only the confirm button (Spec 12: the double-tap settle window). */
  confirmDisabled?: boolean;
  /** Changing this while open moves focus back to Cancel (Spec 12: step 1 → step 2 in place). */
  focusKey?: string | number;
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
  dismissible = true,
  confirmDisabled = false,
  focusKey,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The latest `open`, so the native `close` handler can tell "the dialog closed itself" from "the
  // parent closed it" (same reasoning as `Sheet`, Spec 06.1 §6.7).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const isOpen = dialog.hasAttribute("open");
    if (open && !isOpen) dialog.showModal();
    else if (!open && isOpen) dialog.close();
  }, [open]);

  // Spec 12 D12: the safe action takes the initial focus *explicitly* — DOM order alone stops being
  // true as soon as a body contains a button. Declared after the showModal effect so the dialog is
  // already modal when focus moves.
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>("[data-confirm-cancel]")?.focus();
  }, [open, focusKey]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        // Controlled: tell the parent, and let it flip `open`.
        event.preventDefault();
        if (dismissible) onCancel();
      }}
      onClose={() => {
        // A second Escape / Android back without intervening user activation closes the dialog
        // natively. Left alone, the parent's `open` stays true and the next tap on Finish / Discard /
        // Remove would do nothing for the rest of the session. A non-dismissible dialog reopens instead.
        if (!openRef.current) return;
        if (dismissible) onCancel();
        else ref.current?.showModal();
      }}
    >
      {open ? (
        <div className={styles.content}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          <div className={styles.body}>{children}</div>
          <div className={styles.actions}>
            <Button variant="secondary" disabled={busy} onClick={onCancel} data-confirm-cancel="">
              {cancelLabel}
            </Button>
            <Button variant={variant} busy={busy} disabled={confirmDisabled} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
