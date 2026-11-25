import { useCallback, useRef, useState } from "react";

import { chooseCurrent, lastLoggedId, type CurrentRow } from "./currentExercise";

export interface CurrentExercise {
  readonly currentId: string | null;
  /** A tap or a reveal: the lifter's choice. */
  select(id: string): void;
  /** The exercise the lifter just added: selected once the refetch shows it (AC13). */
  selectWhenAdded(id: string): void;
  /** Auto-advance: moves only if `loggedId` is still current, so a late response never pulls the lifter back (AC14). */
  advanceFrom(loggedId: string, nextId: string): void;
  /**
   * Minors 710, 713: how many choices `select` and `selectWhenAdded` have made, counted the moment they're called (so
   * a gate set in the same tick sees it). `advanceFrom` and the fallback never count: a reveal is dropped only when
   * the lifter chose since it was set.
   */
  choiceNow(): number;
}

interface Chosen {
  readonly id: string | null;
  /** Waiting for a just-added exercise to appear in the rows. */
  readonly awaiting: boolean;
}

/**
 * Spec 17.1 §6.2 "The hook": stores only what the lifter chose and falls back to `chooseCurrent` when that choice no
 * longer applies (the exercise was removed). Another device's change never moves it. Nothing is persisted (D3).
 */
export function useCurrentExercise(rows: readonly CurrentRow[]): CurrentExercise {
  const [chosen, setChosen] = useState<Chosen>(() => ({ id: chooseCurrent(rows, lastLoggedId(rows)), awaiting: false }));
  const present = chosen.id !== null && rows.some((r) => r.exercise.id === chosen.id);
  let currentId = chosen.id;
  // Adjusting state while rendering: React's pattern for state that must follow a changed prop.
  if (!present) {
    currentId = chooseCurrent(rows, lastLoggedId(rows));
    if (!chosen.awaiting && chosen.id !== currentId) setChosen({ id: currentId, awaiting: false });
  } else if (chosen.awaiting) {
    setChosen({ id: chosen.id, awaiting: false });
  }

  const choices = useRef(0);
  const select = useCallback((id: string) => {
    choices.current += 1;
    setChosen({ id, awaiting: false });
  }, []);
  const selectWhenAdded = useCallback((id: string) => {
    choices.current += 1;
    setChosen({ id, awaiting: true });
  }, []);
  const advanceFrom = useCallback(
    (loggedId: string, nextId: string) => setChosen((c) => (c.id === loggedId ? { id: nextId, awaiting: false } : c)),
    [],
  );
  const choiceNow = useCallback(() => choices.current, []);
  return { currentId, select, selectWhenAdded, advanceFrom, choiceNow };
}
