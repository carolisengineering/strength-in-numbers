import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { Modality, SetEntry, WorkoutExerciseDetail } from "@sin/core";

import type { DraftRestore, LoggedEvent } from "./EntryRow";
import type { IdMap, OutboxOp } from "./outbox/ops";
import type { RestStore } from "./restStore";
import { offeredRow, undoAnnouncement, undoLine, undoPhase, type UndoOffer, type UndoPhase } from "./undoOffer";
import { useDeleteSet } from "./useWorkoutMutations";

export interface UndoLastLogInput {
  exercises: readonly WorkoutExerciseDetail[];
  ops: readonly OutboxOp[];
  idMap: IdMap;
  rest: RestStore | null;
  select: (exerciseId: string) => void;
  /** Would making this exercise current collapse the card that holds focus? */
  focusLeavesWith: (exerciseId: string) => boolean;
  /** Show the current panel once this commit lands (17.4's `setsAwaited`). */
  revealPanel: () => void;
  onFailure: (error: unknown) => void;
  announce: (text: string) => void;
}

export interface UndoLastLog {
  offer: { row: SetEntry; value: string; exerciseName: string } | null;
  /** What the line says about an Undo under way or done, or `null`. */
  undoText: string | null;
  offerFrom(event: LoggedEvent, exercise: { name: string; modality: Modality }, restStartedAt: number | null): void;
  end(): void;
  undo(event: MouseEvent<HTMLButtonElement>): void;
  restore: DraftRestore | null;
  restoreDone(token: number): void;
}

interface Undoing {
  row: SetEntry;
  /** The delete has reached the queue. Until then "no ops" doesn't mean done, so the phase can't be read yet. */
  settled: boolean;
}

/**
 * Spec 17.5: the latest log's Undo. React state only, never stored (D2). A log's row renders after `onLogged` runs (the
 * query cache tells its observers a moment later), so an offer can be held before its row is listed; only a row that
 * has been seen and then left ends it. Undo is the same delete Delete set uses (D1), so the outbox's cancel-or-delete
 * rules apply and it works offline.
 */
export function useUndoLastLog({ exercises, ops, idMap, rest, select, focusLeavesWith, revealPanel, onFailure, announce }: UndoLastLogInput): UndoLastLog {
  const del = useDeleteSet();
  const [held, setHeld] = useState<{ offer: UndoOffer; seen: boolean } | null>(null);
  const [undoing, setUndoing] = useState<Undoing | null>(null);
  const [restore, setRestore] = useState<DraftRestore | null>(null);
  const nextToken = useRef(0);

  const row = held === null ? null : offeredRow(held.offer, exercises);
  // Adjusting state while rendering: React's pattern for state that must follow a changed prop.
  if (held !== null) {
    if (row !== null && !held.seen) setHeld({ offer: held.offer, seen: true });
    else if (row === null && held.seen) setHeld(null);
  }

  const phase: UndoPhase | null = undoing === null ? null : undoing.settled ? undoPhase(undoing.row, ops, idMap) : "undoing";
  // AC6: a rejected delete hands over to the row's own marks. Forget it, so a later Discard can't read as "undone".
  if (phase === "failed") setUndoing(null);

  // AC13: announced from the queue's own answer, so a canceled create says only "undone".
  const spoken = undoing?.settled && phase !== null ? undoAnnouncement(phase, undoing.row.setNumber) : null;
  useEffect(() => {
    if (spoken !== null) announce(spoken);
  }, [spoken, announce]);

  const offerFrom = useCallback<UndoLastLog["offerFrom"]>((event, exercise, restStartedAt) => {
    setUndoing(null);
    setHeld({
      offer: { exerciseId: event.exerciseId, exerciseName: exercise.name, modality: exercise.modality, set: event.set, value: event.value, restStartedAt },
      seen: false,
    });
  }, []);
  const end = useCallback(() => {
    setHeld(null);
    setUndoing(null);
  }, []);
  const restoreDone = useCallback((token: number) => setRestore((current) => (current?.token === token ? null : current)), []);

  // The tap reads this ref, not state, and clears it at once: a second tap before the commit finds nothing (AC14).
  const live = useRef<{ offer: UndoOffer; row: SetEntry } | null>(null);
  useLayoutEffect(() => {
    live.current = held !== null && row !== null ? { offer: held.offer, row } : null;
  });

  function undo(event: MouseEvent<HTMLButtonElement>) {
    const target = live.current;
    if (target === null) return;
    live.current = null;
    setHeld(null);
    setUndoing({ row: target.row, settled: false });
    announce(""); // AC13: a live region says nothing when its words don't change, and "Set N undone" can repeat
    // Undo unmounts, and so does a card it collapses, so focus in either goes to Log rather than falling to the page.
    // `preventScroll`: scrolling to a sticky element drags the list.
    const button = event.currentTarget;
    if (button === document.activeElement || focusLeavesWith(target.offer.exerciseId)) {
      button.closest("[data-session-bar]")?.querySelector<HTMLElement>(":scope > button")?.focus({ preventScroll: true });
    }
    void run(target);
  }

  async function run({ offer, row: set }: { offer: UndoOffer; row: SetEntry }) {
    try {
      await del.mutateAsync({ id: set.id, modality: offer.modality, viaUndo: true });
    } catch (error) {
      onFailure(error);
      setUndoing(null);
      return;
    }
    setUndoing((current) => (current?.row === set ? { row: set, settled: true } : current));
    if (offer.restStartedAt !== null && rest?.get()?.startedAt === offer.restStartedAt) rest.clear();
    select(offer.exerciseId);
    revealPanel();
    nextToken.current += 1;
    setRestore({ token: nextToken.current, exerciseId: offer.exerciseId, set });
  }

  return {
    offer: held !== null && row !== null ? { row, value: held.offer.value, exerciseName: held.offer.exerciseName } : null,
    undoText: undoing === null || phase === null ? null : undoLine(phase, undoing.row.setNumber),
    offerFrom,
    end,
    undo,
    restore,
    restoreDone,
  };
}
