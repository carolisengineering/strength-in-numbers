import { useId, useState, type ReactNode } from "react";

import { Button } from "../../ui/Button";
import styles from "./WorkoutMenu.module.css";

export interface WorkoutMenuProps {
  /** Row 1's left side: the elapsed clock, or "Took …" when the workout has a plan (Spec 18.0 AC34). */
  leading: ReactNode;
  /** Row 2, under row 1 and above the revealed items (Spec 18.0 D22): "Started …" and Change Time. */
  below?: ReactNode;
  endItem: {
    label: "End workout early" | "Finish workout";
    disabled: boolean;
    /** Why it is disabled, tied by aria-describedby. */
    reason: string | null;
    onClick: () => void;
  };
  onDiscard: () => void;
}

/**
 * Spec 17.1 D13: the rare, away-from-the-thumb actions share one inline disclosure (the Options pattern, no popover).
 * The items stay revealed while their dialog is open, so the dialog can hand focus back to the item that opened it.
 */
export function WorkoutMenu({ leading, below, endItem, onDiscard }: WorkoutMenuProps) {
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const described = endItem.disabled && endItem.reason !== null;
  return (
    <div className={styles.top}>
      <div className={styles.row}>
        <div className={styles.leading}>{leading}</div>
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Workout menu
        </Button>
      </div>
      {below}
      {open ? (
        <div className={styles.items}>
          <Button variant="secondary" disabled={endItem.disabled} {...(described ? { "aria-describedby": reasonId } : {})} onClick={endItem.onClick}>
            {endItem.label}
          </Button>
          {described ? (
            <p id={reasonId} className={styles.reason}>
              {endItem.reason}
            </p>
          ) : null}
          <Button variant="danger" onClick={onDiscard}>
            Discard workout
          </Button>
        </div>
      ) : null}
    </div>
  );
}
