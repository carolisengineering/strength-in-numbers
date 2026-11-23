import { createContext, useContext, useMemo, useState } from "react";

/**
 * Spec 17.12 Phase C: what `ExercisesLayout` holds for the screens under it, across the list's moves between the
 * index and the list pane (a resize across 64rem).
 * - `hold(id)`: keep `id` selected until the next navigation, so a page deleting the exercise that opened by default
 *   stays mounted, dialog and all, until the delete's navigation lands (minor 659). `hold(null)` releases it.
 * - `query` / `setQuery`: All exercises' search text (minor 662).
 */
export interface ExercisesLayoutState {
  hold(id: string | null): void;
  query: string;
  setQuery(query: string): void;
}

export const ExercisesLayoutContext = createContext<ExercisesLayoutState | null>(null);

const noHold = () => {};

/** The layout's state, or, for a screen rendered with no layout (a test), a local one with the same shape. */
export function useExercisesLayoutState(): ExercisesLayoutState {
  const layout = useContext(ExercisesLayoutContext);
  const [query, setQuery] = useState("");
  const local = useMemo(() => ({ hold: noHold, query, setQuery }), [query]);
  return layout ?? local;
}
