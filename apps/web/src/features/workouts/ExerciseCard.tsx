import { useId, useState } from "react";
import type { SetEntry, WorkoutExerciseDetail } from "@sin/core";

import { Button } from "../../ui/Button";
import { MODALITY_LABELS } from "../catalog/labels";
import { EntryRow } from "./EntryRow";
import { formatSet } from "./format";
import { SetEditSheet } from "./SetEditSheet";
import styles from "./ExerciseCard.module.css";

export interface ExerciseCardProps {
  exercise: WorkoutExerciseDetail;
  isFirst: boolean;
  isLast: boolean;
  /** An exercise-structure write (or its refetch) is in flight: every structure control waits. */
  structureBusy: boolean;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
  /** Weight and distance units default from the profile (D26). */
  unitPreference: "kg" | "lb";
  /** The workout is gone or finished elsewhere (§5.8 gone path). */
  onGone: () => void;
}

/**
 * One exercise in the session (Spec 06.1 §5.4): its name and modality, an Options row (Move up / Move
 * down / Remove exercise — buttons, not drag-and-drop, D16), and its logged sets.
 */
export function ExerciseCard({
  exercise,
  isFirst,
  isLast,
  structureBusy,
  onMove,
  onRemove,
  unitPreference,
  onGone,
}: ExerciseCardProps) {
  const headingId = useId();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editing, setEditing] = useState<SetEntry | null>(null);

  return (
    <article className={styles.card} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h2 className={styles.name} id={headingId}>
            {exercise.exerciseNameSnapshot}
          </h2>
          <p className={styles.modality}>{MODALITY_LABELS[exercise.modalitySnapshot]}</p>
        </div>
        <Button variant="secondary" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}>
          Options
        </Button>
      </header>

      {optionsOpen ? (
        <div className={styles.options}>
          <Button variant="secondary" disabled={isFirst || structureBusy} onClick={() => onMove("up")}>
            Move up
          </Button>
          <Button variant="secondary" disabled={isLast || structureBusy} onClick={() => onMove("down")}>
            Move down
          </Button>
          <Button variant="danger" disabled={structureBusy} onClick={onRemove}>
            Remove exercise
          </Button>
        </div>
      ) : null}

      {exercise.sets.length > 0 ? (
        <ol className={styles.sets}>
          {exercise.sets.map((set) => (
            <li key={set.id}>
              <button type="button" className={styles.set} onClick={() => setEditing(set)}>
                <span className={styles.setNumber}>{set.setNumber}</span>
                <span>{formatSet(set, exercise.modalitySnapshot)}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <EntryRow exercise={exercise} unitPreference={unitPreference} onGone={onGone} />

      <SetEditSheet
        set={editing}
        modality={exercise.modalitySnapshot}
        exerciseName={exercise.exerciseNameSnapshot}
        unitPreference={unitPreference}
        onClose={() => setEditing(null)}
        onGone={onGone}
      />
    </article>
  );
}
