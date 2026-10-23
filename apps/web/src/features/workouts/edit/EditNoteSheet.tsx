import { useRef, useState } from "react";
import type { WorkoutExerciseDetail } from "@sin/core";

import { NoteSheet } from "../NoteSheet";
import { reportUnexpected } from "../reportUnexpected";
import type { EditScreenMode } from "../screenMode";
import { EDIT_COPY } from "./editCopy";
import { resolveEditFailure } from "./editFailure";
import { useEditSetNote } from "./useEditMutations";

/**
 * Spec 18.0 AC12: the exercise-note sheet on the edit screen. Unlike live (optimistic, queued), Save waits for the
 * server: busy while it answers, closed only on success, and open with the typed text and an inline error otherwise.
 */
export function EditNoteSheet({ open, exercise, onClose, mode }: { open: boolean; exercise: WorkoutExerciseDetail; onClose: () => void; mode: EditScreenMode }) {
  const save = useEditSetNote();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function onSave(notes: string | null) {
    if (inFlight.current) return;
    if (notes === (exercise.notes ?? null)) {
      onClose(); // unchanged: no request
      return;
    }
    inFlight.current = true;
    setError(null);
    try {
      await save.mutateAsync({ workoutId: mode.workoutId, id: exercise.id, notes });
      onClose();
      mode.report({ type: "saved", announcement: "Note saved" });
    } catch (caught) {
      reportUnexpected("update-note", caught);
      const failure = resolveEditFailure("update-note", caught);
      switch (failure.type) {
        case "missing":
          onClose();
          mode.report(failure);
          return;
        case "message":
          setError(failure.text);
          return;
        case "fields":
          // The server's messages are static (#57); show the first, else the row's copy.
          setError(failure.fieldErrors[0]?.message ?? failure.fallback);
          return;
        default:
          setError(EDIT_COPY.retry["update-note"]);
      }
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <NoteSheet
      open={open}
      exerciseName={exercise.exerciseNameSnapshot}
      initial={exercise.notes}
      onSave={(notes) => void onSave(notes)}
      onClose={onClose}
      // DM-12: a save in flight keeps the sheet open (Cancel, Close, Escape), so its failure shows here. Live is unchanged.
      dismissible={!save.isPending}
      saving={save.isPending}
      saveError={error}
    />
  );
}
