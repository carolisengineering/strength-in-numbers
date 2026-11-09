import { useEffect, useId, useRef } from "react";

import { Button } from "../../ui/Button";
import styles from "./SetDeleteConfirm.module.css";

export interface SetDeleteConfirmProps {
  text: string;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}

/**
 * Spec 17.5 AC18, D5: replaces a set sheet's Delete / Save row while it asks. No nested dialog: two stacked modals would
 * send focus back to the sheet's opener. Keep set takes focus, so a stray Enter keeps the set.
 */
export function SetDeleteConfirm({ text, busy, onKeep, onConfirm }: SetDeleteConfirmProps) {
  const textId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
  }, []);
  return (
    <div className={styles.confirm} role="group" aria-labelledby={textId}>
      <p id={textId} className={styles.text}>
        {text}
      </p>
      <div className={styles.buttons}>
        <Button variant="secondary" ref={keepRef} disabled={busy} onClick={onKeep}>
          Keep set
        </Button>
        <Button variant="danger" busy={busy} onClick={onConfirm}>
          Delete set
        </Button>
      </div>
    </div>
  );
}
