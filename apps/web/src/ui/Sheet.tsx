import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "./Button";
import styles from "./Sheet.module.css";
import { CloseIcon } from "./icons";
import { SheetSlotsContext, type SheetSlots } from "./sheetSlots";

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
  /** Spec 17.10: the bottom row's dismiss button's text. Default "Cancel". */
  dismissLabel?: string;
  /**
   * Spec 17.10: what the row's dismiss button does, when that isn't closing (the picker's create view goes back
   * to its list). Default `onClose`. Close and Escape always call `onClose`.
   */
  onDismiss?: () => void;
  children?: ReactNode;
}

const NO_SLOTS: SheetSlots = { danger: null, primary: null, status: null, notice: null };

/**
 * Full-height modal sheet (Spec 06.0 §5, AC24) on the native `<dialog>`.
 * Opened with `showModal()`, the browser traps focus inside it, makes the
 * page behind it inert, and returns focus to the opener on close — no
 * library needed.
 *
 * The Close button is first in DOM order, so `showModal()`'s automatic focus
 * lands on it instead of on a text field (which would raise the phone
 * keyboard). CSS puts it visually on the right.
 *
 * Spec 17.10: below the scrolling body, as its sibling (never sticky, so it covers nothing), is one action row:
 * danger, dismiss, primary. `Sheet` draws the dismiss button; a sheet's own `SheetActions` portals the others in.
 */
export function Sheet({
  open,
  title,
  onClose,
  dismissible = true,
  dismissLabel = "Cancel",
  onDismiss,
  children,
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The row's slot elements, held in state through callback refs so `SheetActions` re-renders into them. A ref
  // callback runs in the commit, so its update lands before paint and the row never shows empty.
  const [slots, setSlots] = useState<SheetSlots>(NO_SLOTS);
  const slotRefs = useMemo(() => {
    const refFor = (slot: keyof SheetSlots) => (element: HTMLElement | null) => {
      setSlots((current) => (current[slot] === element ? current : { ...current, [slot]: element }));
    };
    return { danger: refFor("danger"), primary: refFor("primary"), status: refFor("status"), notice: refFor("notice") };
  }, []);
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
          <SheetSlotsContext.Provider value={slots}>
            <div className={styles.panel}>
              <div className={styles.body} data-sheet-body="">
                {children}
              </div>
              <div className={styles.actions} data-sheet-actions="">
                {/* Minor 492: one box for the notice and status, which scrolls once the row reaches 60% of the panel,
                    so on a short frame a failure plus a question can't squeeze the body to nothing. */}
                <div className={styles.messages} data-sheet-messages="">
                  <div className={styles.notice} ref={slotRefs.notice} />
                  <div className={styles.status} ref={slotRefs.status} data-sheet-status="" />
                </div>
                <div className={styles.buttons}>
                  <div className={styles.slot} ref={slotRefs.danger} />
                  <Button
                    variant="secondary"
                    aria-disabled={dismissible ? undefined : true}
                    onClick={() => {
                      if (dismissible) (onDismiss ?? onClose)();
                    }}
                  >
                    {dismissLabel}
                  </Button>
                  <div className={styles.slot} ref={slotRefs.primary} />
                </div>
              </div>
            </div>
          </SheetSlotsContext.Provider>
        </>
      ) : null}
    </dialog>
  );
}
