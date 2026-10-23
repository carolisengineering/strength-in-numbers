import { useEffect, useId, useRef, type ReactNode } from "react";

import styles from "./Sheet.module.css";
import { CloseIcon } from "./icons";

export interface SheetProps {
  /** The parent owns this; the sheet never closes itself. */
  open: boolean;
  title: string;
  /** Called by the Close button and by Escape / the Android back gesture, and when the dialog closed itself. */
  onClose: () => void;
  /**
   * DM-12: false while a save is in flight, so its failure shows in the open sheet. Close (marked `aria-disabled`)
   * and Escape do nothing; a close the browser makes anyway still calls `onClose`, so the parent stays in step.
   */
  dismissible?: boolean;
  children?: ReactNode;
}

/**
 * Full-height modal sheet (Spec 06.0 §5, AC24) on the native `<dialog>`.
 * Opened with `showModal()`, the browser traps focus inside it, makes the
 * page behind it inert, and returns focus to the opener on close — no
 * library needed.
 *
 * The Close button is first in DOM order, so `showModal()`'s automatic focus
 * lands on it instead of on a text field (which would raise the phone
 * keyboard). CSS puts it visually on the right.
 */
export function Sheet({ open, title, onClose, dismissible = true, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The latest `open`, so the native `close` handler can tell "the dialog closed itself" (a form
  // method=dialog, a browser close request) from "the parent closed it" (the effect below).
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

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Controlled: tell the parent, and let it flip `open`. Not while a save is in flight (DM-12).
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClose={() => {
        // Spec 06.1 AC32: a natively-closed sheet would leave the parent's `open` true, so the next
        // "open" would do nothing. Silent when the parent did the closing.
        if (openRef.current) onClose();
      }}
    >
      {open ? (
        <>
          <header className={styles.header}>
            <button
              type="button"
              className={styles.close}
              aria-label="Close"
              aria-disabled={dismissible ? undefined : true}
              onClick={() => {
                if (dismissible) onClose();
              }}
            >
              <CloseIcon />
            </button>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
          </header>
          <div className={styles.body}>{children}</div>
        </>
      ) : null}
    </dialog>
  );
}
