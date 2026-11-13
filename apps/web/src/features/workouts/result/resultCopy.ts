import { RESULT_REPS_MAX, RESULT_ROUNDS_MAX } from "@sin/core";

import { formatCount } from "../format";

/** Spec 10.7 AC56 — every string the Log result sheet, its sync tag and the timer lock show. Pinned by exact text. */
export const RESULT_COPY = Object.freeze({
  title: "Log result",
  next: "Next",
  roundLabel: (n: number): string => `Round ${n}`,
  total: (clock: string): string => `Total ${clock}`,
  rounds: "Rounds",
  reps: "Reps",
  // Minor 330: over the max is an error on Save, never a silent clamp.
  roundsMax: `Keep it to ${formatCount(RESULT_ROUNDS_MAX)} or less.`,
  repsMax: `Keep it to ${formatCount(RESULT_REPS_MAX)} or less.`,
  // Spec 17.8 AC4: the steppers show their step, and each name starts with it.
  stepDown: "\u22121",
  stepUp: "+1",
  decreaseRounds: "\u22121, decrease rounds",
  increaseRounds: "+1, increase rounds",
  decreaseReps: "\u22121, decrease reps",
  increaseReps: "+1, increase reps",
  roundEnds: "Round ends (optional)",
  roundEndsHint: "Type the gym clock when each round ended.",
  addRoundTime: "Add round time",
  // The Time Cap radio group's legend, visually hidden (a plan call: the radios need a group name).
  outcome: "Result",
  finished: "Finished",
  hitCap: "Hit the cap",
  finishTime: "Finish time",
  clearResult: "Clear result",
  cancel: "Cancel",
  save: "Save",
  saved: "Result saved",
  sectionGone: "That section no longer exists",
  timerGone: "This section has no timer now.",
  /** Minors 329, 333: another device changed the section's timer while Log result was open. */
  timerChanged: "This section's timer changed.",
  partial: "Couldn't save all of the result — check it and try again",
  notSaved: "Not saved yet",
  notSavedFailed: "Couldn't be saved",
  timerLocked: "Wait for the logged times to save before changing the timer.",
  /** Minor 328: every entry failed, so waiting won't unlock it; Discard on the sync line will. */
  timerLockedFailed: "Discard the times that couldn't be saved first.",
  timerEntries: (n: number): string => (n === 1 ? "1 timer entry" : `${n} timer entries`),
});
