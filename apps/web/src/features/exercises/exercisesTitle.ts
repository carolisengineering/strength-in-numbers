import { createContext, useContext, type RefObject } from "react";

/**
 * What `ExercisesListScreen` hands its views (Spec 17.12, was 18.2's outlet context): the title, for a view that moves
 * focus to it (Spec 18.2 Phase B's notices). In the list pane the title is an `h2`; it can still take focus.
 */
export type ExercisesTitle = { titleRef: RefObject<HTMLHeadingElement | null> };

export const ExercisesTitleContext = createContext<ExercisesTitle>({ titleRef: { current: null } });

export function useExercisesTitle(): ExercisesTitle {
  return useContext(ExercisesTitleContext);
}
