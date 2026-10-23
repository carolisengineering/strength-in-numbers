import { describe, expect, it } from "vitest";
import { buildPatch, initialForm, normalize, validate } from "./details";

const TITLE_TOO_LONG = "Title can be at most 120 characters.";
const NOTES_TOO_LONG = "Notes can be at most 4000 characters.";
const CONTROL = "Remove characters that can't be saved.";

describe("18.0 AC53 / AC54 — details rules", () => {
  it.each([
    ["  a  ", "a"],
    [" \n ", null],
    ["", null],
    ["a  b\nc", "a  b\nc"],
  ])("normalize(%j) → %j", (text, expected) => {
    expect(normalize(text)).toBe(expected);
  });

  it.each<[string, string, string | null]>([
    ["title", "x".repeat(120), null],
    ["title", "x".repeat(121), TITLE_TOO_LONG],
    ["title", "😀".repeat(120), null], // Zod counts code points (the server's measure), not UTF-16 length
    ["title", "😀".repeat(121), TITLE_TOO_LONG],
    ["notes", "x".repeat(4000), null],
    ["notes", "x".repeat(4001), NOTES_TOO_LONG],
    ["title", "a\nb", CONTROL],
    ["title", "a\u0007b", CONTROL],
    ["notes", "a\nb\tc", null],
    ["notes", "a\u0007b", CONTROL],
    ["title", "   ", null],
  ])("validate(%s, …) → %s", (field, text, expected) => {
    expect(validate(field as "title" | "notes", text)).toBe(expected);
  });

  it("initialForm maps null to empty text", () => {
    expect(initialForm({ title: null, notes: "n" })).toEqual({ title: "", notes: "n" });
  });

  it("buildPatch: unchanged → null; only the changed key; a cleared field is null, never an empty string", () => {
    const initial = { title: "Heavy day", notes: "n" };
    expect(buildPatch(initial, { ...initial })).toBeNull();
    expect(buildPatch(initial, { ...initial, title: "Light day " })).toEqual({ title: "Light day" });
    expect(buildPatch(initial, { ...initial, title: "" })).toEqual({ title: null });
    expect(buildPatch(initial, { title: "Heavy day", notes: "two\nlines" })).toEqual({ notes: "two\nlines" });
  });

  it("DM-3 — a whitespace-only edit is no change: the saved value would be the same, so no request", () => {
    const initial = { title: "Heavy day", notes: "n" };
    expect(buildPatch(initial, { title: "Heavy day ", notes: " n\n" })).toBeNull();
    expect(buildPatch({ title: "", notes: "" }, { title: "   ", notes: "\n" })).toBeNull();
    expect(buildPatch(initial, { ...initial, title: " Heavy  day" })).toEqual({ title: "Heavy  day" });
  });
});
