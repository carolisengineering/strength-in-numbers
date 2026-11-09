import { useCallback, useState, type MouseEvent } from "react";
import type { Modality, SetEntry, WorkoutExerciseDetail } from "@sin/core";

import type { DraftRestore, LoggedEvent } from "./EntryRow";
import type { IdMap, OutboxOp } from "./outbox/ops";
import type { RestStore } from "./restStore";
import { offeredRow, type UndoOffer } from "./undoOffer";

export interface UndoLastLogInput {
  exercises: readonly WorkoutExerciseDetail[];
  ops: readonly OutboxOp[];
  idMap: IdMap;
  rest: RestStore | null;
  select: (exerciseId: string) => void;
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

/**
 * Spec 17.5: the latest log's Undo. React state only, never stored (D2). A log's row renders after `onLogged` runs (the
 * query cache tells its observers a moment later), so an offer can be held before its row is listed; only a row that
 * has been seen and then left ends it.
 */
export function useUndoLastLog({ exercises }: UndoLastLogInput): UndoLastLog {
  const [held, setHeld] = useState<{ offer: UndoOffer; seen: boolean } | null>(null);
  const row = held === null ? null : offeredRow(held.offer, exercises);
  // Adjusting state while rendering: React's pattern for state that must follow a changed prop.
  if (held !== null) {
    if (row !== null && !held.seen) setHeld({ offer: held.offer, seen: true });
    else if (row === null && held.seen) setHeld(null);
  }

  const offerFrom = useCallback<UndoLastLog["offerFrom"]>((event, exercise, restStartedAt) => {
    setHeld({
      offer: { exerciseId: event.exerciseId, exerciseName: exercise.name, modality: exercise.modality, set: event.set, value: event.value, restStartedAt },
      seen: false,
    });
  }, []);
  const end = useCallback(() => setHeld(null), []);

  return {
    offer: held !== null && row !== null ? { row, value: held.offer.value, exerciseName: held.offer.exerciseName } : null,
    undoText: null,
    offerFrom,
    end,
    undo: () => undefined,
    restore: null,
    restoreDone: () => undefined,
  };
}
