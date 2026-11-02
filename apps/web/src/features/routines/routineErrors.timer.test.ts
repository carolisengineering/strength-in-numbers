import { describe, expect, it } from "vitest";
import { sectioned } from "../../test/sectionedDraft";
import { CAP_MAX_ERROR, ROUND_LENGTH_MAX_ERROR, ROUNDS_RANGE_ERROR, TIMER_CHECK_ERROR } from "../sectionTimer/timerCopy";
import { serverIssuesFor } from "./routineErrors";
import { sectionError, sectionMessagesFor } from "./sheetIssues";

const draft = sectioned("x", ["W", "a"], ["M", "b"]);
const err = (path: string) => ({ path, message: "server text" });

describe("10.7 AC10 — server field errors", () => {
  it.each<[string, "rounds" | "roundSeconds" | "capSeconds" | "group", string]>([
    ["sections.1.timer.rounds", "rounds", ROUNDS_RANGE_ERROR],
    ["sections.1.timer.roundSeconds", "roundSeconds", ROUND_LENGTH_MAX_ERROR],
    ["sections.1.timer.capSeconds", "capSeconds", CAP_MAX_ERROR],
    ["sections.1.timer", "group", TIMER_CHECK_ERROR],
    ["sections.1.timer.format", "group", TIMER_CHECK_ERROR],
  ])("%s → the sheet's %s, in the app's words", (path, field, message) => {
    const out = serverIssuesFor([err(path)], draft);
    expect(out.unmatched).toBe(false);
    expect(sectionMessagesFor(out.issues, "M")).toEqual({ timer: { [field]: message } });
    expect(sectionError(out.issues, "M")).toBe(message);
    expect(JSON.stringify(out.issues)).not.toContain("server text");
  });

  it("two timer fields on one section both reach the sheet", () => {
    const out = serverIssuesFor([err("sections.1.timer.rounds"), err("sections.1.timer.roundSeconds")], draft);
    expect(sectionMessagesFor(out.issues, "M")).toEqual({ timer: { rounds: ROUNDS_RANGE_ERROR, roundSeconds: ROUND_LENGTH_MAX_ERROR } });
  });

  it("a name error and a timer error keep their own fields", () => {
    const out = serverIssuesFor([err("sections.1.name"), err("sections.1.timer.capSeconds")], draft);
    expect(sectionMessagesFor(out.issues, "M")).toEqual({ name: expect.any(String), timer: { capSeconds: CAP_MAX_ERROR } });
  });
});
