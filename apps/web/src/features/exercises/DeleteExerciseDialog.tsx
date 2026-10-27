import type { Exercise } from "@sin/core";
import { useEffect } from "react";

import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Spinner } from "../../ui/Spinner";
import { useCatalog } from "../catalog/useCatalog";
import { reportUnexpected } from "../workouts/reportUnexpected";
import styles from "./DeleteExerciseDialog.module.css";
import { classifyExerciseError } from "./exerciseErrors";
import { EXERCISES_COPY } from "./messages";
import { useExerciseRoutines } from "./routines";

const SHOWN_ROUTINES = 5;

export interface DeleteExerciseDialogProps {
  open: boolean;
  row: Exercise;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (routineCount: number) => void;
}

/**
 * Delete an own exercise or copy (Spec 18.2 AC46–AC49). It reads which routines use the exercise and keeps Delete
 * disabled until that answer is in (D12): the lifter never deletes without having seen it. Names are React text.
 */
export function DeleteExerciseDialog({ open, row, busy, onCancel, onConfirm }: DeleteExerciseDialogProps) {
  const routines = useExerciseRoutines(row.id, { enabled: open });
  const { state } = useCatalog();
  const originName =
    row.forkedFromExerciseId === null ? undefined : (state.rows.find((r) => r.id === row.forkedFromExerciseId)?.name ?? null);

  useEffect(() => {
    if (routines.error && classifyExerciseError(routines.error) === "unknown") reportUnexpected("load-exercise-routines", routines.error);
  }, [routines.error]);

  const list = routines.data;
  let body;
  if (list === undefined && routines.isError) {
    body = (
      <>
        <p>{EXERCISES_COPY.routinesCheckFailed}</p>
        <Button variant="secondary" onClick={() => void routines.refetch()}>
          {EXERCISES_COPY.tryAgain}
        </Button>
      </>
    );
  } else if (list === undefined) {
    body = <Spinner label={EXERCISES_COPY.checkingRoutines} />;
  } else {
    body = (
      <>
        <p>{EXERCISES_COPY.deleteKeepsHistory}</p>
        {list.length > 0 ? (
          <>
            <p>{EXERCISES_COPY.usedIn(list.length)}</p>
            <ul className={styles.routines}>
              {list.slice(0, SHOWN_ROUTINES).map((r) => (
                <li key={r.id}>{r.oneOffUntil !== null ? EXERCISES_COPY.oneOffRoutine(r.name) : r.name}</li>
              ))}
            </ul>
            {list.length > SHOWN_ROUTINES ? <p>{EXERCISES_COPY.andMore(list.length - SHOWN_ROUTINES)}</p> : null}
            <p>{EXERCISES_COPY.routinesBreak(list.length)}</p>
          </>
        ) : null}
        {originName !== undefined ? <p>{EXERCISES_COPY.copyComesBack(originName)}</p> : null}
      </>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      title={EXERCISES_COPY.deleteTitle(row.name)}
      variant="danger"
      confirmLabel={EXERCISES_COPY.deleteConfirm}
      confirmDisabled={list === undefined}
      busy={busy}
      // Escape mid-delete would hide a delete that still completes (deferred minor 125).
      dismissible={!busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (list !== undefined) onConfirm(list.length);
      }}
    >
      <div className={styles.body}>{body}</div>
    </ConfirmDialog>
  );
}
