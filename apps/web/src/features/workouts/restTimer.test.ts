import type { PlannedSet } from "@sin/core";
import { describe, expect, it } from "vitest";

import { remainingSeconds, restAfterLog, restProgress, type RestRow } from "./restTimer";

const plan = (n: number): PlannedSet[] =>
  Array.from({ length: n }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
const sets = (n: number) => Array.from({ length: n }, (_, i) => ({ createdAt: `2026-10-16T10:0${i}:00.000Z` }));
function row(id: string, o: { planned?: number; logged?: number; rest?: number | null; linkedBelow?: boolean } = {}): RestRow {
  return {
    exercise: { id, plannedSets: plan(o.planned ?? 3), sets: sets(o.logged ?? 0), restSeconds: o.rest === undefined ? 120 : o.rest },
    linkedBelow: o.linkedBelow ?? false,
  };
}

describe("17.1 AC43 — the clock decides", () => {
  const timer = { startedAt: 1_000_000, durationS: 120 };
  it.each([
    [0, 120],
    [1, 120], // ceil: 119.999 s left still reads 2:00
    [999, 120],
    [1000, 119],
    [90_000, 30], // one 90 s jump, no intermediate ticks
    [119_001, 1],
    [120_000, 0],
    [500_000, 0], // clamped at 0
  ])("at +%i ms shows %i s", (dt, left) => {
    expect(remainingSeconds(timer, timer.startedAt + dt)).toBe(left);
  });
  it("no timer means 0", () => expect(remainingSeconds(null, 5)).toBe(0));
  it("a clock moved back never reads more than the rest's own length (Review Focus 2)", () => {
    expect(remainingSeconds(timer, timer.startedAt - 60_000)).toBe(120);
    expect(restProgress(timer, timer.startedAt - 60_000)).toBe(0);
  });
  it("progress runs 0 → 1", () => {
    expect(restProgress(timer, timer.startedAt)).toBe(0);
    expect(restProgress(timer, timer.startedAt + 60_000)).toBe(0.5);
    expect(restProgress(timer, timer.startedAt + 999_000)).toBe(1);
  });
});

describe("17.1 AC41 / AC42 / AC52 — when a log starts a rest (§6.10)", () => {
  it("a working set on an exercise with stored rest starts that rest", () => {
    const rows = [row("A", { logged: 1 }), row("B")];
    expect(restAfterLog({ rows, loggedId: "A", setType: "working" })).toEqual({ durationS: 120 });
  });
  it.each([
    ["no stored rest", null],
    ["a zero rest", 0],
  ])("%s starts none", (_label, rest) => {
    const rows = [row("A", { logged: 1, rest }), row("B")];
    expect(restAfterLog({ rows, loggedId: "A", setType: "working" })).toBeNull();
  });
  it("a warm-up starts none (D8)", () => {
    const rows = [row("A", { logged: 1 }), row("B")];
    expect(restAfterLog({ rows, loggedId: "A", setType: "warmup" })).toBeNull();
  });
  it.each(["drop", "failure"] as const)("a %s set rests like a working set", (setType) => {
    const rows = [row("A", { logged: 1 }), row("B")];
    expect(restAfterLog({ rows, loggedId: "A", setType })).toEqual({ durationS: 120 });
  });
  it("the last planned set of the workout starts none", () => {
    const rows = [row("A", { logged: 3 }), row("B", { logged: 3 })];
    expect(restAfterLog({ rows, loggedId: "B", setType: "working" })).toBeNull();
  });
  it("an extra set on a done exercise rests while others still have planned sets", () => {
    const rows = [row("A", { logged: 4 }), row("B")];
    expect(restAfterLog({ rows, loggedId: "A", setType: "working" })).toEqual({ durationS: 120 });
  });
  it("a free-form workout (no plans anywhere) never rests", () => {
    const rows = [row("A", { planned: 0, logged: 2, rest: 90 })];
    expect(restAfterLog({ rows, loggedId: "A", setType: "working" })).toBeNull();
  });
  it("superset mid-round: no rest between A and B", () => {
    const rows = [row("A", { logged: 1, linkedBelow: true }), row("B", { logged: 0 })];
    expect(restAfterLog({ rows, loggedId: "A", setType: "working" })).toBeNull();
  });
  it("superset round end (the wrap): rests with the logged member's own rest", () => {
    const rows = [row("A", { logged: 1, linkedBelow: true, rest: 60 }), row("B", { logged: 1, rest: 90 })];
    expect(restAfterLog({ rows, loggedId: "B", setType: "working" })).toEqual({ durationS: 90 });
  });
  it("superset round end with a null rest on the logged member: none", () => {
    const rows = [row("A", { logged: 1, linkedBelow: true, rest: 60 }), row("B", { logged: 1, rest: null })];
    expect(restAfterLog({ rows, loggedId: "B", setType: "working" })).toBeNull();
  });
  it("superset whose partner is done: every log completes a round (the exercise itself)", () => {
    const rows = [row("A", { logged: 2, linkedBelow: true }), row("B", { planned: 1, logged: 1 }), row("C")];
    expect(restAfterLog({ rows, loggedId: "A", setType: "working" })).toEqual({ durationS: 120 });
  });
  it("three-member run: the middle member is mid-round", () => {
    const rows = [row("A", { logged: 1, linkedBelow: true }), row("B", { logged: 1, linkedBelow: true }), row("C", { logged: 0 })];
    expect(restAfterLog({ rows, loggedId: "B", setType: "working" })).toBeNull();
  });
  it("an unknown id starts none", () => {
    expect(restAfterLog({ rows: [row("A")], loggedId: "Z", setType: "working" })).toBeNull();
  });
});
