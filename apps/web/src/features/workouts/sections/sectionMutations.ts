import type { CreateWorkoutSection, UpdateWorkoutSection, WorkoutExercise, WorkoutSection } from "@sin/core";

/**
 * Spec 10.6 §6.3 — the four section writes, in one shape for both screens. The live screen passes
 * `useSectionMutations` (the live client, invalidate the active workout); Phase B's edit screen
 * passes its own set. Types only, so an edit module never imports the live hook file.
 */
export interface SectionMutations {
  /** Spec 10.7 AC15: the bodies carry `timer` (and the update `discardResult`, after the AC16 confirm). */
  add(body: CreateWorkoutSection): Promise<WorkoutSection>;
  update(id: string, body: UpdateWorkoutSection): Promise<WorkoutSection>;
  /** `exerciseCount` is only for the event; a `404` counts as done. */
  remove(id: string, exerciseCount: number): Promise<void>;
  setSection(exerciseId: string, sectionId: string | null): Promise<WorkoutExercise>;
  /** Any of the four is in flight. */
  readonly pending: boolean;
}
