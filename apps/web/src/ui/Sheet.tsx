import { useEffect, useId, useRef, type ReactNode } from "react";

import styles from "./Sheet.module.css";

export interface SheetProps {
  /** The parent owns this; the sheet never closes itself. */
  open: boolean;
  title: string;
  /** Called by the Close button and by Escape / the Android back gesture. */
  onClose: () => void;
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
export function Sheet({ open, title, onClose, children }: SheetProps) {
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
        // Controlled: tell the parent, and let it flip `open`.
        event.preventDefault();
        onClose();
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
            <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
              <span aria-hidden="true">×</span>
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
