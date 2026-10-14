import { useId, useState } from "react";
import type { SetEntry, WorkoutExerciseDetail } from "@sin/core";

import { Button } from "../../ui/Button";
import { MODALITY_LABELS } from "../catalog/labels";
import { EntryRow } from "./EntryRow";
import { formatSet } from "./format";
import type { RowSync } from "./outbox/project";
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
  /** Working sets the server refused to finish over (§5.6): marked with visible "Needs data" text. */
  flaggedIds: ReadonlySet<string>;
  /** The session's first flagged set (in display order): its row gets `firstFlaggedRef`, for scroll-into-view. */
  firstFlaggedId?: string | null;
  firstFlaggedRef?: (node: HTMLButtonElement | null) => void;
  /** Weight and distance units default from the profile (D26). */
  unitPreference: "kg" | "lb";
  /** The workout is gone or finished elsewhere (§5.8 gone path); `reason` feeds `workout_conflict`. */
  onGone: (reason: "gone" | "finished") => void;
  /** Per-row sync state from the outbox projection (Spec 06.2 AC14); synced rows are absent. */
  sync?: ReadonlyMap<string, RowSync>;
  onDiscardOp?: (opId: string) => void;
  /** The session's first failed row gets `failedRowRef` (the status line's "Show"). */
  firstFailedId?: string | null;
  failedRowRef?: (node: HTMLLIElement | null) => void;
  /** Spec 10.1 AC16: the routine's targets for this exercise; `""` when none. */
  targetLine?: string;
  /** Spec 10.1 AC17: the card's name when it sits in a superset run; `null` names it by its heading. */
  accessibleName?: string | null;
  /** Spec 10.3: why a Move button is disabled at a section edge; only passed for headed segments. */
  moveReasons?: { up: string | null; down: string | null };
}

export const SEGMENT_FIRST_REASON = "First exercise in this section";
export const SEGMENT_LAST_REASON = "Last exercise in this section";
const NO_REASONS = { up: null, down: null } as const;

const NO_SYNC: ReadonlyMap<string, RowSync> = new Map();

/**
 * One exercise in the session (Spec 06.1 §5.4): its name and modality, an Options row (Move up / Move
 * down / Remove exercise — buttons, not drag-and-drop, D16), and its logged sets. Spec 10.1 adds the
 * routine's target line and notes under the name, display only.
 */
export function ExerciseCard({
  exercise,
  isFirst,
  isLast,
  structureBusy,
  onMove,
  onRemove,
  flaggedIds,
  firstFlaggedId = null,
  firstFlaggedRef,
  unitPreference,
  onGone,
  sync = NO_SYNC,
  onDiscardOp,
  firstFailedId = null,
  failedRowRef,
  targetLine = "",
  accessibleName = null,
  moveReasons = NO_REASONS,
}: ExerciseCardProps) {
  const reasonId = useId();
  const headingId = useId();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editing, setEditing] = useState<SetEntry | null>(null);

  return (
    <article className={styles.card} {...(accessibleName ? { "aria-label": accessibleName } : { "aria-labelledby": headingId })}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h2 className={styles.name} id={headingId}>
            {exercise.exerciseNameSnapshot}
          </h2>
          <p className={styles.modality}>{MODALITY_LABELS[exercise.modalitySnapshot]}</p>
          {targetLine === "" ? null : <p className={styles.target}>{targetLine}</p>}
          {exercise.notes ? <p className={styles.notes}>{exercise.notes}</p> : null}
        </div>
        <Button variant="secondary" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}>
          Options
        </Button>
      </header>

      {optionsOpen ? (
        <div className={styles.options}>
          <Button variant="secondary" disabled={isFirst || structureBusy} {...(isFirst && moveReasons.up ? { "aria-describedby": `${reasonId}-up` } : {})} onClick={() => onMove("up")}>
            Move up
          </Button>
          {isFirst && moveReasons.up ? <p id={`${reasonId}-up`} className={styles.reason}>{moveReasons.up}</p> : null}
          <Button variant="secondary" disabled={isLast || structureBusy} {...(isLast && moveReasons.down ? { "aria-describedby": `${reasonId}-down` } : {})} onClick={() => onMove("down")}>
            Move down
          </Button>
          {isLast && moveReasons.down ? <p id={`${reasonId}-down`} className={styles.reason}>{moveReasons.down}</p> : null}
          <Button variant="danger" disabled={structureBusy} onClick={onRemove}>
            Remove exercise
          </Button>
        </div>
      ) : null}

      {exercise.sets.length > 0 ? (
        <ol className={styles.sets}>
          {exercise.sets.map((set) => {
            const needsData = flaggedIds.has(set.id);
            const rowSync = sync.get(set.id);
            return (
              <li
                key={set.id}
                ref={set.id === firstFailedId ? failedRowRef : undefined}
                className={rowSync?.state === "failed" ? styles.setRow : undefined}
              >
                <button
                  type="button"
                  ref={set.id === firstFlaggedId ? firstFlaggedRef : undefined}
                  className={needsData ? `${styles.set} ${styles.needsData}` : styles.set}
                  data-needs-data={needsData ? "true" : undefined}
                  onClick={() => setEditing(set)}
                >
                  <span className={styles.setNumber}>{set.setNumber}</span>
                  <span>{formatSet(set, exercise.modalitySnapshot)}</span>
                  {/* Text, not colour alone, marks the row (AC33). */}
                  {needsData ? <span className={styles.needsDataTag}>Needs data</span> : null}
                  {rowSync?.state === "pending" ? <span className={styles.pendingTag}>Not saved yet</span> : null}
                  {rowSync?.state === "failed" ? <span className={styles.failedTag}>Couldn't save</span> : null}
                </button>
                {rowSync?.state === "failed" ? (
                  <span className={styles.rowActions}>
                    {rowSync.status === 422 ? (
                      <Button variant="secondary" onClick={() => setEditing(set)}>
                        Edit
                      </Button>
                    ) : null}
                    <Button variant="secondary" onClick={() => onDiscardOp?.(rowSync.opId)}>
                      Discard
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
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
