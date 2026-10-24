import { describe, expect, it } from "vitest";
import type { WorkoutSection } from "@sin/core";
import { SECTION_COPY } from "./sectionCopy";
import { checkSectionFields, sectionBody } from "./sectionFields";

const stored = (name: string, notes: string | null): WorkoutSection =>
  ({ id: "00000000-0000-4000-8000-000000000001", position: 0, name, notes, addedInWorkout: true }) as WorkoutSection;

describe("10.6 AC5 — checkSectionFields", () => {
  it.each([
    ["an all-space name", "  ", "", { name: SECTION_COPY.nameRequired, notes: null }],
    ["41 trimmed characters", ` ${"a".repeat(41)} `, "", { name: SECTION_COPY.nameTooLong, notes: null }],
    ["40 trimmed characters", ` ${"a".repeat(40)} `, "", { name: null, notes: null }],
    ["a 2001-character note", "A", "n".repeat(2001), { name: null, notes: SECTION_COPY.noteTooLong }],
    ["a 2000-character note", "A", "n".repeat(2000), { name: null, notes: null }],
    ["a bell in the name", "a\u0007", "", { name: SECTION_COPY.badChars, notes: null }],
    ["a tab and newlines in the note", "A", "a\tb\r\n", { name: null, notes: null }],
    ["a bell in the note", "A", "a\u0007", { name: null, notes: SECTION_COPY.badChars }],
    ["an all-whitespace note is empty", "A", " \n ", { name: null, notes: null }],
  ])("%s", (_label, name, notes, expected) => {
    expect(checkSectionFields(name, notes)).toStrictEqual(expected);
  });
});

describe("10.6 AC5 / AC7 — sectionBody", () => {
  it("add: an empty note is omitted; a note is sent trimmed of nothing but the name", () => {
    expect(sectionBody("add", { name: " Warm-up ", notes: "" })).toStrictEqual({ name: "Warm-up" });
    expect(sectionBody("add", { name: "Warm-up", notes: "   " })).toStrictEqual({ name: "Warm-up" });
    expect(sectionBody("add", { name: "Warm-up", notes: "5 min" })).toStrictEqual({ name: "Warm-up", notes: "5 min" });
  });

  it("edit: only the changed keys; an emptied note is null; unchanged is null", () => {
    const s = stored("Warm-up", "5 min");
    expect(sectionBody("edit", { name: "Warm-up", notes: "10 min" }, s)).toStrictEqual({ notes: "10 min" });
    expect(sectionBody("edit", { name: "Warm-up", notes: "" }, s)).toStrictEqual({ notes: null });
    expect(sectionBody("edit", { name: "Prep", notes: "5 min" }, s)).toStrictEqual({ name: "Prep" });
    expect(sectionBody("edit", { name: "Warm-up", notes: "5 min" }, s)).toBeNull();
    expect(sectionBody("edit", { name: "  Warm-up ", notes: "5 min" }, s)).toBeNull();
    expect(sectionBody("edit", { name: "Warm-up", notes: "  " }, stored("Warm-up", null))).toBeNull();
  });
});
