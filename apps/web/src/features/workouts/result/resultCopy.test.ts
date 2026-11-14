import { describe, expect, it } from "vitest";
import { RESULT_COPY } from "./resultCopy";

describe("10.7 AC56 — Phase C copy is pinned", () => {
  it("every constant is the exact text", () => {
    const { roundLabel, total, timerEntries, ...strings } = RESULT_COPY;
    expect(strings).toStrictEqual({
      title: "Log result",
      next: "Next",
      rounds: "Rounds",
      reps: "Reps",
      roundsMax: "Keep it to 999 or less.",
      repsMax: "Keep it to 9,999 or less.",
      // Spec 17.8 AC4: the visible step leads each name.
      stepDown: "−1",
      stepUp: "+1",
      decreaseRounds: "−1, decrease rounds",
      increaseRounds: "+1, increase rounds",
      decreaseReps: "−1, decrease reps",
      increaseReps: "+1, increase reps",
      roundEnds: "Round ends (optional)",
      roundEndsHint: "Type the gym clock when each round ended.",
      addRoundTime: "Add round time",
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
      timerChanged: "This section's timer changed.",
      partial: "Couldn't save all of the result — check it and try again",
      notSaved: "Not saved yet",
      notSavedFailed: "Couldn't be saved",
      timerLocked: "Wait for the logged times to save before changing the timer.",
      timerLockedFailed: "Discard the times that couldn't be saved first.",
    });
    expect(roundLabel(3)).toBe("Round 3");
    expect(total("14:03")).toBe("Total 14:03");
    expect(timerEntries(1)).toBe("1 timer entry");
    expect(timerEntries(3)).toBe("3 timer entries");
    expect(Object.isFrozen(RESULT_COPY)).toBe(true);
  });
});
