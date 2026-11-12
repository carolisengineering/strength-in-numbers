import type { Exercise } from "@sin/core";
import { useRef, useState } from "react";

import { Button } from "../../ui/Button";
import { EditExerciseSheet } from "./EditExerciseSheet";
import styles from "./ExerciseActions.module.css";
import { ForkButton } from "./ForkButton";
import { EXERCISES_COPY } from "./messages";

export interface ExerciseActionsProps {
  row: Exercise;
  /** The page's polite status line ("" clears it). */
  onStatus: (text: string) => void;
  onDelete: () => void;
  /** The ref the page uses to return focus to Delete exercise when its dialog closes. */
  deleteRef?: React.Ref<HTMLButtonElement>;
}

/**
 * The page's actions (Spec 18.2 AC34): an own exercise or a copy gets Edit and Delete exercise; a built-in gets
 * the note and Make your own copy. The server is the check (§7); this only hides what it would refuse.
 */
export function ExerciseActions({ row, onStatus, onDelete, deleteRef }: ExerciseActionsProps) {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);

  if (row.ownerUserId === null) {
    return (
      <div className={styles.actions}>
        <p className={styles.note}>{EXERCISES_COPY.builtInNote}</p>
        <ForkButton row={row} onStatus={onStatus} />
      </div>
    );
  }

  const close = () => {
    setEditing(false);
    // The native dialog returns focus to the opener; this does the same where it doesn't (AC54).
    editRef.current?.focus();
  };

  return (
    <div className={styles.actions}>
      <div className={styles.buttons}>
        <Button
          ref={editRef}
          variant="secondary"
          onClick={() => {
            onStatus("");
            setEditing(true);
          }}
        >
          {EXERCISES_COPY.edit}
        </Button>
        <Button ref={deleteRef} variant="secondary" onClick={onDelete}>
          {EXERCISES_COPY.deleteExercise}
        </Button>
      </div>
      <EditExerciseSheet
        open={editing}
        row={row}
        onClose={close}
        onSaved={() => {
          close();
          onStatus(EXERCISES_COPY.saved);
        }}
        onGone={() => {
          setEditing(false);
          onStatus(EXERCISES_COPY.alreadyDeleted);
        }}
      />
    </div>
  );
}
