import { useId, useState } from "react";
import type { SetEntry, WorkoutExerciseDetail } from "@sin/core";

import { Button } from "../../ui/Button";
import { CheckIcon } from "../../ui/icons";
import { MODALITY_LABELS } from "../catalog/labels";
import { EntryRow, type LoggedEvent } from "./EntryRow";
import { NoteSheet } from "./NoteSheet";
import type { RowSync } from "./outbox/project";
import { collapsedSync, type CollapsedSummary } from "./summaryLine";
import { SetEditSheet } from "./SetEditSheet";
import { useSetExerciseNote } from "./useWorkoutMutations";
import styles from "./ExerciseCard.module.css";
import { SetText, WarmupMark } from "./WarmupMark";

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
  failedRowRef?: (node: HTMLElement | null) => void;
  /** Spec 10.1 AC16: the routine's targets for this exercise; `""` when none. */
  targetLine?: string;
  /** Spec 10.1 AC17: the card's name when it sits in a superset run; `null` names it by its heading. */
  accessibleName?: string | null;
  /** Spec 10.3: why a Move button is disabled at a section edge; only passed for headed segments. */
  moveReasons?: { up: string | null; down: string | null };
  /** Spec 17.1 AC11: the heading takes focus when the lifter makes this card current. */
  headingRef?: (node: HTMLHeadingElement | null) => void;
  /** Spec 17.1 §6.5: the entry panel's successful log, for auto-advance. */
  onLogged?: (event: LoggedEvent) => void;
  /** Spec 17.1 AC27: Finish mode. */
  logExtra?: boolean;
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
  headingRef,
  onLogged,
  logExtra,
}: ExerciseCardProps) {
  const reasonId = useId();
  const headingId = useId();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editing, setEditing] = useState<SetEntry | null>(null);
  const setNote = useSetExerciseNote();
  const [noteSheet, setNoteSheet] = useState<{ session: number; open: boolean } | null>(null);
  const noteSync = sync.get(exercise.id);
  const hasNote = Boolean(exercise.notes);
  function saveNote(notes: string | null) {
    setNoteSheet((s) => s && { ...s, open: false }); // optimistic: the sheet never waits on the network
    if (notes === (exercise.notes ?? null)) return; // unchanged: just close
    setNote.mutate({ id: exercise.id, notes });
  }

  return (
    <article className={styles.card} {...(accessibleName ? { "aria-label": accessibleName } : { "aria-labelledby": headingId })}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h2 className={styles.name} id={headingId} ref={headingRef} tabIndex={-1}>
            {exercise.exerciseNameSnapshot}
          </h2>
          <p className={styles.modality}>{MODALITY_LABELS[exercise.modalitySnapshot]}</p>
          {targetLine === "" ? null : <p className={styles.target}>{targetLine}</p>}
          {exercise.notes ? <p className={styles.notes}>{exercise.notes}</p> : null}
          <div className={styles.noteRow} data-note-action="" ref={exercise.id === firstFailedId ? failedRowRef : undefined}>
            <Button
              variant="secondary"
              aria-label={`${hasNote ? "Edit" : "Add"} note for ${exercise.exerciseNameSnapshot}`}
              onClick={() => setNoteSheet((s) => ({ session: (s?.session ?? 0) + 1, open: true }))}
            >
              {hasNote ? "Edit note" : "Add note"}
            </Button>
            {/* Text, not color alone, marks the state (as for set rows). */}
            {noteSync?.state === "pending" ? <span className={styles.pendingTag}>Not saved yet</span> : null}
            {noteSync?.state === "failed" ? (
              <>
                <span className={styles.failedTag}>Couldn't save</span>
                <Button variant="secondary" aria-label={`Discard note for ${exercise.exerciseNameSnapshot}`} onClick={() => onDiscardOp?.(noteSync.opId)}>
                  Discard
                </Button>
              </>
            ) : null}
          </div>
        </div>
        {/* Spec 17.1 AC38 (WCAG 2.5.3): visible text first, the exercise after. */}
        <Button variant="secondary" aria-label={`Options for ${exercise.exerciseNameSnapshot}`} aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}>
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
                  className={[styles.set, needsData ? styles.needsData : "", set.setType === "warmup" ? styles.warmup : ""].filter(Boolean).join(" ")}
                  data-set-type={set.setType}
                  data-needs-data={needsData ? "true" : undefined}
                  onClick={() => setEditing(set)}
                >
                  <span className={styles.setNumber}>{set.setNumber}</span>
                  <WarmupMark setType={set.setType} />
                  <SetText set={set} modality={exercise.modalitySnapshot} />
                  {/* Text, not color alone, marks the row (AC33). */}
                  {needsData ? <span className={styles.needsDataTag}>Needs data</span> : null}
                  {rowSync?.state === "pending" ? <span className={styles.pendingTag}>Not saved yet</span> : null}
                  {rowSync?.state === "failed" ? <span className={styles.failedTag}>Couldn't save</span> : null}
                </button>
                {rowSync?.state === "failed" ? (
                  <span className={styles.rowActions}>
                    {rowSync.status === 422 ? (
                      <Button variant="secondary" aria-label={`Edit set ${set.setNumber} of ${exercise.exerciseNameSnapshot}`} onClick={() => setEditing(set)}>
                        Edit
                      </Button>
                    ) : null}
                    <Button variant="secondary" aria-label={`Discard set ${set.setNumber} of ${exercise.exerciseNameSnapshot}`} onClick={() => onDiscardOp?.(rowSync.opId)}>
                      Discard
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      <EntryRow exercise={exercise} unitPreference={unitPreference} onGone={onGone} {...(onLogged ? { onLogged } : {})} {...(logExtra ? { logExtra } : {})} />

      {noteSheet ? (
        <NoteSheet
          key={noteSheet.session}
          open={noteSheet.open}
          exerciseName={exercise.exerciseNameSnapshot}
          initial={exercise.notes}
          onSave={saveNote}
          onClose={() => setNoteSheet((s) => s && { ...s, open: false })}
        />
      ) : null}

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

export interface CollapsedExerciseProps {
  exercise: WorkoutExerciseDetail;
  summary: CollapsedSummary;
  /** The article's name: the superset label in a run, else the exercise's name (as on the expanded card). */
  accessibleName?: string | null;
  sync?: ReadonlyMap<string, RowSync>;
  onSelect: () => void;
}

/**
 * Spec 17.1 AC9–AC10: an exercise that is not current is one summary line. The whole line is the heading's button;
 * it mounts no entry row, sheet or Options (one extra tap to edit or move, §6.3).
 */
export function CollapsedExercise({ exercise, summary, accessibleName = null, sync = NO_SYNC, onSelect }: CollapsedExerciseProps) {
  const state = collapsedSync(exercise, sync);
  return (
    <article className={`${styles.card} ${styles.collapsed}`} aria-label={accessibleName ?? exercise.exerciseNameSnapshot}>
      <h2 className={styles.collapsedHeading}>
        <button type="button" className={styles.summary} aria-expanded={false} aria-label={summary.name} onClick={onSelect}>
          <span className={styles.summaryText}>{summary.text}</span>
          {summary.done ? <CheckIcon className={styles.check} /> : null}
        </button>
      </h2>
      {/* Text, not color alone, marks the state (06.2 AC14). */}
      {state === "pending" ? <span className={styles.pendingTag}>Not saved yet</span> : null}
      {state === "failed" ? <span className={styles.failedTag}>Couldn't save</span> : null}
    </article>
  );
}
