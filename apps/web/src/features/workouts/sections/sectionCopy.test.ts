import { describe, expect, it } from "vitest";
import { SECTION_COPY, changeTimerTitle, editLabel, logResultLabel, movedOut, movedTo, rateLimited, removeTitle, sectionAdded } from "./sectionCopy";

describe("10.6 AC22 — copy is pinned", () => {
  it("every constant is the exact text", () => {
    expect(SECTION_COPY).toStrictEqual({
      edit: "Edit",
      addSection: "Add section",
      cancel: "Cancel",
      save: "Save",
      removeSection: "Remove section",
      removeConfirm: "Remove",
      empty: "No exercises yet.",
      limit: "A workout can have up to 8 sections.",
      lineBefore: "New exercises go into ",
      lineAfter: ".",
      newTitle: "New section",
      newIntro: "Exercises you add next go into this section.",
      editTitle: "Edit section",
      nameLabel: "Name",
      noteLabel: "Note",
      noteHint: "Anything beyond sets and reps.",
      nameRequired: "Enter a name.",
      nameTooLong: "Keep the name to 40 characters.",
      noteTooLong: "Keep the note to 2000 characters.",
      badChars: "Remove characters that can't be saved.",
      fieldsGeneric: "Check the name and note and try again.",
      removeLine: "Its exercises and sets stay in the workout, without a section.",
      saved: "Section saved",
      removed: "Section removed",
      sectionLabel: "Section",
      noSection: "No section",
      supersetHint: "Changing the section takes it out of its superset.",
      sectionGone: "That section no longer exists",
      addUnconfirmed: "Couldn't confirm that section was added — check your workout before adding it again",
      saveFailed: "Couldn't save the section — try again",
      removeFailed: "Couldn't remove the section — try again",
      moveFailed: "Couldn't move that exercise — try again",
      // Spec 10.7 Phase B (pinned again below under AC56).
      timerSaved: "Timer saved",
      changeTimerBody: "This clears the times and result you logged for this section.",
      changeAndClear: "Change and clear",
      resultExists: "Times were logged for this section. Check them and try again.",
      logResult: "Log result",
      groupFailedTimer: "Timer saved, but the exercises couldn't be grouped — try again",
      groupFailedAdded: "Exercise added, but it couldn't be grouped — try again",
      groupFailedMoved: "Exercise moved, but it couldn't be grouped — try again",
    });
    expect(Object.isFrozen(SECTION_COPY)).toBe(true);
  });

  it("every template gives the exact text", () => {
    expect(editLabel("Warm-up")).toBe("Edit section Warm-up");
    expect(removeTitle("Warm-up")).toBe("Remove Warm-up?");
    expect(sectionAdded("Warm-up")).toBe("Section added: Warm-up");
    expect(movedTo("Row Erg", "Warm-up")).toBe("Moved Row Erg to Warm-up");
    expect(movedOut("Row Erg")).toBe("Moved Row Erg out of its section");
    expect(rateLimited(null)).toBe("Too many changes in a short time — wait a minute and try again");
    expect(rateLimited(1000)).toBe("Too many changes in a short time — try again in 1 second");
    expect(rateLimited(200)).toBe("Too many changes in a short time — try again in 1 second");
    expect(rateLimited(12_001)).toBe("Too many changes in a short time — try again in 13 seconds");
  });
});

describe("10.7 AC56 — Phase B copy is pinned (sections)", () => {
  it.each<[keyof typeof SECTION_COPY, string]>([
    ["timerSaved", "Timer saved"],
    ["changeTimerBody", "This clears the times and result you logged for this section."],
    ["changeAndClear", "Change and clear"],
    ["resultExists", "Times were logged for this section. Check them and try again."],
    ["logResult", "Log result"],
    ["groupFailedTimer", "Timer saved, but the exercises couldn't be grouped — try again"],
    ["groupFailedAdded", "Exercise added, but it couldn't be grouped — try again"],
    ["groupFailedMoved", "Exercise moved, but it couldn't be grouped — try again"],
  ])("%s", (key, text) => {
    expect(SECTION_COPY[key]).toBe(text);
  });

  it("the templates", () => {
    expect(changeTimerTitle("Main")).toBe("Change Main's timer?");
    expect(logResultLabel("Main")).toBe("Log result for Main");
  });
});
