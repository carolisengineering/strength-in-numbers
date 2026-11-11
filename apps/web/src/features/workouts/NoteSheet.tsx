import { useId, useState } from "react";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Sheet } from "../../ui/Sheet";
import { SheetActions } from "../../ui/SheetActions";
import { EXERCISE_NOTE_MAX, parseExerciseNote } from "./exerciseNote";
import styles from "./NoteSheet.module.css";
import sheetStyles from "./SetEditSheet.module.css";

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
  const formId = useId();
  return (
    <Sheet open={open} title={`Note for ${exerciseName}`} onClose={onClose} dismissible={dismissible}>
      <form
        id={formId}
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
        <Field id="exercise-note" label="Note" hint={`${Array.from(text).length} / ${EXERCISE_NOTE_MAX}`} {...(error ? { error } : {})}>
          {(control) => <textarea {...control} className={styles.input} rows={5} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </form>
      {/* Spec 17.10: Cancel is the row's; `dismissible` latches it, as it does Close. A failed save shows in the row, so
          it stays in view over a tall note; a parse error stays under the field, and the save error waits behind it. */}
      <SheetActions
        notice={
          !error && saveError ? (
            <p className={sheetStyles.formError} role="alert">
              {saveError}
            </p>
          ) : null
        }
        primary={
          <Button type="submit" form={formId} busy={saving}>
            Save
          </Button>
        }
      />
    </Sheet>
  );
}
