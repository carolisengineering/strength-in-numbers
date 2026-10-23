import { useState } from "react";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Sheet } from "../../ui/Sheet";
import { EXERCISE_NOTE_MAX, parseExerciseNote } from "./exerciseNote";
import styles from "./NoteSheet.module.css";

export interface NoteSheetProps {
  open: boolean;
  exerciseName: string;
  initial: string | null;
  onSave: (notes: string | null) => void;
  onClose: () => void;
  /** Spec 18.0 AC12 (edit mode): Save is busy while the server answers, and a second submit does nothing. */
  saving?: boolean;
  /** Spec 18.0 AC12: the failed save's text, shown under the field when there is no parse error. */
  saveError?: string | null;
  /** DM-12 (edit mode): false while the save is in flight; Close, Escape and Cancel then do nothing. */
  dismissible?: boolean;
}

/** One exercise's note for THIS workout (Spec 10.3 AC27). Local state; Save parses, Cancel and Close discard. Keyed per opening by the card. */
export function NoteSheet({ open, exerciseName, initial, onSave, onClose, saving = false, saveError = null, dismissible = true }: NoteSheetProps) {
  const [text, setText] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} title={`Note for ${exerciseName}`} onClose={onClose} dismissible={dismissible}>
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (saving) return;
          const parsed = parseExerciseNote(text);
          if (!parsed.ok) {
            setError(parsed.message);
            return;
          }
          onSave(parsed.value);
        }}
      >
        {/* The count is a hint; the error is its own text, so the count is never the only cue (AC37). */}
        <Field id="exercise-note" label="Note" hint={`${Array.from(text).length} / ${EXERCISE_NOTE_MAX}`} {...(error ?? saveError ? { error: error ?? saveError ?? "" } : {})}>
          {(control) => <textarea {...control} className={styles.input} rows={5} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className={styles.actions}>
          <Button type="submit" busy={saving}>
            Save
          </Button>
          <Button
            variant="secondary"
            aria-disabled={dismissible ? undefined : true}
            onClick={() => {
              if (dismissible) onClose();
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
