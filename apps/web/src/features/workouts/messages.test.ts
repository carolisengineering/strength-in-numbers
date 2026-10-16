import { describe, expect, it } from "vitest";
import { MESSAGES, unsavedMessage } from "./messages";

describe("06.5 AC22 — copy is static", () => {
  it("every message is a plain string constant", () => {
    for (const value of Object.values(MESSAGES)) expect(typeof value).toBe("string");
  });
  it("the formatter takes one argument of two integers and emits digits for nothing else", () => {
    const text = unsavedMessage({ sets: 3, notes: 0 });
    expect(text.replace(/\D/g, "")).toBe("3");
    expect(unsavedMessage.length).toBe(1);
  });
});

describe("06.5 AC24 — wording for sets, notes and both", () => {
  it.each([
    [{ sets: 1, notes: 0 }, "1 set hasn't saved. If you sign out now it'll be lost."],
    [{ sets: 3, notes: 0 }, "3 sets haven't saved. If you sign out now they'll be lost."],
    [{ sets: 0, notes: 1 }, "1 note hasn't saved. If you sign out now it'll be lost."],
    [{ sets: 0, notes: 2 }, "2 notes haven't saved. If you sign out now they'll be lost."],
    [{ sets: 2, notes: 1 }, "2 sets and 1 note haven't saved. If you sign out now they'll be lost."],
    [{ sets: 1, notes: 2 }, "1 set and 2 notes haven't saved. If you sign out now they'll be lost."],
  ])("%j", (unsaved, expected) => {
    expect(unsavedMessage(unsaved)).toBe(expected);
  });
});
