import { describe, expect, it } from "vitest";
import type { DraftIssue } from "./validateDraft";
import { fieldMessagesFor, itemMessage, rowMessagesFor } from "./sheetIssues";

const issues: DraftIssue[] = [
  { scope: "name", message: "n" },
  { scope: "item", itemKey: "a", field: "targetSets", message: "sets msg" },
  { scope: "item", itemKey: "a", field: "targetRepsHigh", message: "reps msg" },
  { scope: "item", itemKey: "a", field: "weight", message: "weight msg" },
  { scope: "item", itemKey: "a", field: "restSeconds", message: "rest msg" },
  { scope: "item", itemKey: "b", field: "notes", message: "other item" },
  { scope: "row", itemKey: "a", rowKey: "r2", field: "weight", message: "row weight" },
  { scope: "row", itemKey: "a", rowKey: "r2", field: "reps", message: "row reps" },
];

describe("10.2 AC16 — issues reach the sheet's fields", () => {
  it("quick fields by item", () => {
    expect(fieldMessagesFor(issues, "a")).toEqual({ sets: "sets msg", reps: "reps msg", weight: "weight msg", rest: "rest msg" });
    expect(fieldMessagesFor(issues, "b")).toEqual({ notes: "other item" });
    expect(fieldMessagesFor(issues, "zzz")).toEqual({});
  });
  it("plan rows by row key", () => {
    expect(rowMessagesFor(issues, "a")).toEqual(new Map([["r2", { weight: "row weight", reps: "row reps" }]]));
    expect(rowMessagesFor(issues, "b").size).toBe(0);
  });
  it("the editor row shows the first item- or row-scope message for its item", () => {
    expect(itemMessage(issues, "a")).toBe("sets msg");
    expect(itemMessage([issues[6]!], "a")).toBe("row weight");
    expect(itemMessage(issues, "zzz")).toBeNull();
  });
});
