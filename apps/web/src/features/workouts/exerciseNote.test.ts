import { describe, expect, it } from "vitest";
import { NOTES_MESSAGE } from "../routines/targetFormat";
import { EXERCISE_NOTE_MAX, parseExerciseNote } from "./exerciseNote";

describe("10.3 AC27 — parseExerciseNote", () => {
  it.each([
    ["Left shoulder tight", { ok: true, value: "Left shoulder tight" }],
    ["  trimmed \n", { ok: true, value: "trimmed" }],
    ["", { ok: true, value: null }],
    ["   \n\t", { ok: true, value: null }],
    ["line one\nline two\tTabbed\r\n", { ok: true, value: "line one\nline two\tTabbed" }],
    ["a".repeat(EXERCISE_NOTE_MAX), { ok: true, value: "a".repeat(EXERCISE_NOTE_MAX) }],
    ["🏋".repeat(EXERCISE_NOTE_MAX), { ok: true, value: "🏋".repeat(EXERCISE_NOTE_MAX) }], // code points
    ["a".repeat(EXERCISE_NOTE_MAX + 1), { ok: false, message: NOTES_MESSAGE }],
    ["bell\u0007", { ok: false, message: NOTES_MESSAGE }],
    ["nul\u0000", { ok: false, message: NOTES_MESSAGE }],
  ])("%j", (text, expected) => {
    expect(parseExerciseNote(text)).toEqual(expected);
  });
  it("the cap is 500 and the message is the routine note's static one", () => {
    expect(EXERCISE_NOTE_MAX).toBe(500);
    expect(NOTES_MESSAGE).toBe("Keep notes to 500 characters");
  });
});
