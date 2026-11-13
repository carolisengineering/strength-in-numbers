import { useEffect, useId, useState } from "react";
import type { SetEntry, WorkoutExerciseDetail, WorkoutSection } from "@sin/core";

import { Button } from "../../ui/Button";
import { CheckIcon, PencilIcon } from "../../ui/icons";
import { MODALITY_LABELS } from "../catalog/labels";
import { LinkToggle } from "../routines/LinkToggle";
import { EntryRow, type DraftRestore, type LoggedEvent } from "./EntryRow";
import { EditNoteSheet } from "./edit/EditNoteSheet";
import { NoteSheet } from "./NoteSheet";
import { useScreenMode } from "./screenMode";
import type { RowSync } from "./outbox/project";
import { collapsedSync, type CollapsedSummary } from "./summaryLine";
import { SectionPicker } from "./sections/SectionPicker";
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
  /** Spec 17.5 AC8: a sheet opened from this card (a set, Add note) ends the Undo offer. */
  onSheetOpen?: () => void;
  /** Spec 17.5: passed straight through to `EntryRow`. */
  restore?: DraftRestore;
  onRestoreDone?: (token: number) => void;
  /** Spec 10.6 AC9: the workout's sections, for the Options panel's Section select (shown only with `onSection`). */
  sections?: readonly WorkoutSection[];
  /** Spec 10.6 AC9: move this exercise to a section (`null` = No section); the server places it. */
  onSection?: (sectionId: string | null) => void;
  /** Spec 10.6 AC11: the card sits in a linked superset run. */
  linked?: boolean;
  /** Spec 17.7 AC19: the live screen's joints with the card above / below in its segment, shown in Options. */
  linkAbove?: CardLink;
  linkBelow?: CardLink;
}

/** One joint of the current card, as `ActiveSession` already computes it for the regroup. */
export interface CardLink {
  otherName: string;
  linked: boolean;
  refusal: string | null;
  disabled: boolean;
  onToggle: () => void;
}

export const SEGMENT_FIRST_REASON = "First exercise in this section";
export const SEGMENT_LAST_REASON = "Last exercise in this section";
/** Spec 17.13 AC14: a segment with no heading (a section-free workout, or the loose tail) says why too. */
export const LOOSE_FIRST_REASON = "First exercise";
export const LOOSE_LAST_REASON = "Last exercise";

/**
 * Spec 17.13 AC14: why a Move button is disabled at its segment's edge, in every workout; both screens call it. "In this
 * section" only inside a real section: the loose tail's "Other exercises" heading is not one.
 */
export function moveReasonsFor(inSection: boolean, isFirst: boolean, isLast: boolean): { up: string | null; down: string | null } {
  return {
    up: isFirst ? (inSection ? SEGMENT_FIRST_REASON : LOOSE_FIRST_REASON) : null,
    down: isLast ? (inSection ? SEGMENT_LAST_REASON : LOOSE_LAST_REASON) : null,
  };
}
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
  onSheetOpen,
  restore,
  onRestoreDone,
  sections,
  onSection,
  linked = false,
  linkAbove,
  linkBelow,
}: ExerciseCardProps) {
  const reasonId = useId();
  const headingId = useId();
  // Spec 18.0 D3: on the edit screen the card keeps its header and set rows and drops the live-only parts.
  const screenMode = useScreenMode();
  const live = screenMode.kind === "live";
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editing, setEditing] = useState<SetEntry | null>(null);
  // Spec 18.0 AC8: each opening of the Add set sheet is a new session (a new form, a new idempotency key).
  const [addSession, setAddSession] = useState(0);
  const [adding, setAdding] = useState(false);
  const setNote = useSetExerciseNote();
  const [noteSheet, setNoteSheet] = useState<{ session: number; open: boolean } | null>(null);
  const sheetOpen = editing !== null || adding || noteSheet?.open === true;
  useEffect(() => {
    if (sheetOpen) onSheetOpen?.();
  }, [sheetOpen, onSheetOpen]);
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
          {/* Spec 17.7 AC21 (D7): while logging, the panel's fields say what is logged; the edit screen keeps the line. */}
          {live ? null : <p className={styles.modality}>{MODALITY_LABELS[exercise.modalitySnapshot]}</p>}
          {targetLine === "" ? null : <p className={styles.target}>{targetLine}</p>}
          {exercise.notes ? <p className={styles.notes}>{exercise.notes}</p> : null}
          {/* Spec 17.7 AC20: the note's sync state stays in the header, drawn only while it is pending or failed (the
              edit screen's sheet waits for the server, so it never has one). The status line's Show scrolls here. */}
          {noteSync ? (
            <div className={styles.noteRow} data-note-action="" ref={exercise.id === firstFailedId ? failedRowRef : undefined}>
              {/* Text, not color alone, marks the state (as for set rows). */}
              {noteSync.state === "pending" ? <span className={styles.pendingTag}>Not saved yet</span> : null}
              {noteSync.state === "failed" ? (
                <>
                  <span className={styles.failedTag}>Couldn't save</span>
                  <Button variant="secondary" aria-label={`Discard note for ${exercise.exerciseNameSnapshot}`} onClick={() => onDiscardOp?.(noteSync.opId)}>
                    Discard
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
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
          {/* Spec 17.7 AC20 (§5 order). Spec 18.0 AC12: on the edit screen its sheet waits for the server. Opening the
              sheet still ends the Undo offer through `onSheetOpen` (Spec 17.5 AC8). */}
          <Button
            variant="secondary"
            data-note-action=""
            aria-label={`${hasNote ? "Edit" : "Add"} note for ${exercise.exerciseNameSnapshot}`}
            onClick={() => setNoteSheet((s) => ({ session: (s?.session ?? 0) + 1, open: true }))}
          >
            {hasNote ? "Edit note" : "Add note"}
          </Button>
          {/* Spec 17.7 AC19, AC23: "Superset with previous: {neighbor}" / "Superset with next: {neighbor}"; either side of a
              joint sends the same regroup (upperId is always the upper card). */}
          {linkAbove ? (
            <LinkToggle
              id={`link-above-${exercise.id}`}
              direction="previous"
              above={linkAbove.otherName}
              below={exercise.exerciseNameSnapshot}
              linked={linkAbove.linked}
              refusal={linkAbove.refusal}
              disabled={linkAbove.disabled}
              onToggle={linkAbove.onToggle}
            />
          ) : null}
          {linkBelow ? (
            <LinkToggle
              id={`link-below-${exercise.id}`}
              direction="next"
              above={exercise.exerciseNameSnapshot}
              below={linkBelow.otherName}
              linked={linkBelow.linked}
              refusal={linkBelow.refusal}
              disabled={linkBelow.disabled}
              onToggle={linkBelow.onToggle}
            />
          ) : null}
          {onSection && sections ? (
            <SectionPicker
              exerciseId={exercise.id}
              value={exercise.sectionId}
              sections={sections}
              linked={linked}
              disabled={structureBusy}
              onChange={onSection}
            />
          ) : null}
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
                  {/* Spec 17.8 AC18: a muted pencil says the row opens its set; aria-hidden, so the name is unchanged. */}
                  <PencilIcon className={styles.setIcon} />
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

      {live ? null : (
        <div className={styles.addSet}>
          <Button
            variant="secondary"
            aria-label={`Add set to ${exercise.exerciseNameSnapshot}`}
            onClick={() => {
              setAddSession((n) => n + 1);
              setAdding(true);
            }}
          >
            Add set
          </Button>
        </div>
      )}

      {live ? (
        <EntryRow exercise={exercise} unitPreference={unitPreference} onGone={onGone} {...(onLogged ? { onLogged } : {})} {...(logExtra ? { logExtra } : {})} {...(restore ? { restore } : {})} {...(onRestoreDone ? { onRestoreDone } : {})} />
      ) : null}

      {screenMode.kind === "edit" && noteSheet ? (
        <EditNoteSheet
          key={noteSheet.session}
          open={noteSheet.open}
          exercise={exercise}
          onClose={() => setNoteSheet((s) => s && { ...s, open: false })}
          mode={screenMode}
        />
      ) : null}
      {live && noteSheet ? (
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
        adding={adding ? { session: addSession, workoutExerciseId: exercise.id, sets: exercise.sets } : null}
        modality={exercise.modalitySnapshot}
        exerciseName={exercise.exerciseNameSnapshot}
        unitPreference={unitPreference}
        onClose={() => {
          setEditing(null);
          setAdding(false);
        }}
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
