import type { PlannedSet } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makeSet } from "../../test/workoutFixtures";
import { createDraftReducer, seedDraft, unitDefaultsFor } from "./setDraft";

const LB = unitDefaultsFor("lb");
const row = (o: Partial<PlannedSet> = {}): PlannedSet => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 185, weightUnit: "lb", ...o });
const logged = (o: Parameters<typeof makeSet>[0] = {}) => makeSet({ setType: "working", weight: 185, weightUnit: "lb", reps: 5, ...o });
const seed = (plannedSets: PlannedSet[], sets: ReturnType<typeof makeSet>[]) => seedDraft({ plannedSets, sets, defaults: LB, attemptKey: "k1" });
const RANGE = { repsLow: 6, repsHigh: 8 };

describe("17.4 AC1 — a weight change carries on a level plan", () => {
  it("190 logged on a level 185 plan makes the next draft 190", () => {
    expect(seed([row(), row(), row()], [logged({ weight: 190 })]).weight).toBe("190");
  });
  it("a lighter set carries too", () => {
    expect(seed([row(), row(), row()], [logged({ weight: 175 })]).weight).toBe("175");
  });
  it("carries again from the set just logged, not from the first departure", () => {
    expect(seed([row(), row(), row()], [logged({ weight: 190 }), logged({ weight: 195 })]).weight).toBe("195");
  });
  it("a set that matches the plan still shows the plan", () => {
    expect(seed([row(), row()], [logged()]).weight).toBe("185");
  });
});

describe("17.4 AC2 — reps inside the range carry", () => {
  it("8 on a 6–8 plan makes the next draft 8", () => {
    expect(seed([row(RANGE), row(RANGE)], [logged({ reps: 8 })]).reps).toBe("8");
  });
  it("both ends of the range are inside", () => {
    expect(seed([row(RANGE), row(RANGE)], [logged({ reps: 6 })]).reps).toBe("6");
    expect(seed([row(RANGE), row(RANGE)], [logged({ reps: 7 })]).reps).toBe("7");
  });
});

describe("17.4 AC3 — reps outside the range go to the low end", () => {
  it("below and above a 6–8 range give 6", () => {
    expect(seed([row(RANGE), row(RANGE)], [logged({ reps: 5 })]).reps).toBe("6");
    expect(seed([row(RANGE), row(RANGE)], [logged({ reps: 10 })]).reps).toBe("6");
  });
  it("an exact plan of 5 goes back to 5 after a set of 6", () => {
    expect(seed([row(), row()], [logged({ reps: 6 })]).reps).toBe("5");
  });
  it("an exact plan with no high end treats the low end as the range", () => {
    const exact = row({ repsLow: 5, repsHigh: null });
    expect(seed([exact, exact], [logged({ reps: 5 })]).reps).toBe("5");
    expect(seed([exact, exact], [logged({ reps: 6 })]).reps).toBe("5");
  });
});

describe("17.4 AC4 — a planned change of weight is followed", () => {
  const RAMP = [row({ weight: 135 }), row({ weight: 155 }), row({ weight: 175 })];
  it("140 on a 135, 155, 175 ramp makes the next draft 155", () => {
    expect(seed(RAMP, [logged({ weight: 140 })]).weight).toBe("155");
  });
  it("a change of planned unit is a planned change", () => {
    expect(seed([row({ weight: 100, weightUnit: "lb" }), row({ weight: 100, weightUnit: "kg" })], [logged({ weight: 105 })])).toMatchObject({ weight: "100", weightUnit: "kg" });
  });
  it("reps still carry on a ramp when the row's range holds them", () => {
    expect(seed([row({ weight: 135, ...RANGE }), row({ weight: 155, ...RANGE })], [logged({ weight: 135, reps: 8 })])).toMatchObject({ weight: "155", reps: "8" });
  });
});

describe("17.4 AC5 — a change of set type follows the plan", () => {
  it("a warm-up hands neither its weight nor its reps to a working set", () => {
    const plan = [row({ setType: "warmup", weight: 185, ...RANGE }), row({ weight: 185, ...RANGE })];
    expect(seed(plan, [logged({ setType: "warmup", weight: 95, reps: 8 })])).toMatchObject({ setType: "working", weight: "185", reps: "6" });
  });
  it("a set logged as Drop against a Working row doesn't lower the next Working set", () => {
    expect(seed([row(RANGE), row(RANGE)], [logged({ setType: "drop", weight: 135, reps: 8 })])).toMatchObject({ setType: "working", weight: "185", reps: "6" });
  });
  it("a working set logged against a planned warm-up doesn't carry into the working rows", () => {
    expect(seed([row({ setType: "warmup" }), row()], [logged({ setType: "working", weight: 190 })]).weight).toBe("185");
  });
  it("setType comes from the row when the values carry", () => {
    expect(seed([row(), row()], [logged({ weight: 190 })]).setType).toBe("working");
  });
});

describe("17.4 AC6 — the unit travels with the weight", () => {
  it("100 lb logged against a level kg plan gives a draft of 100 lb", () => {
    const kg = row({ weight: 80, weightUnit: "kg" });
    expect(seed([kg, kg], [logged({ weight: 100, weightUnit: "lb" })])).toMatchObject({ weight: "100", weightUnit: "lb" });
  });
  it("when the plan's weight is used, so is the plan's unit", () => {
    expect(seed([row({ weight: 135 }), row({ weight: 60, weightUnit: "kg" })], [logged({ weight: 140, weightUnit: "lb" })])).toMatchObject({ weight: "60", weightUnit: "kg" });
  });
});

describe("17.4 AC7 — everything else is unchanged", () => {
  it("the first set shows the plan", () => {
    expect(seed([row(), row()], [])).toMatchObject({ weight: "185", reps: "5" });
  });
  it("a field the row leaves null keeps the copy-forward", () => {
    expect(seed([row({ weight: null, weightUnit: null }), row({ weight: null, weightUnit: null })], [logged({ weight: 190 })]).weight).toBe("190");
    expect(seed([row({ repsLow: null, repsHigh: null }), row({ repsLow: null, repsHigh: null })], [logged({ reps: 9 })]).reps).toBe("9");
  });
  it("a logged set with no weight falls back to the plan's", () => {
    expect(seed([row(), row()], [logged({ weight: null, weightUnit: null })]).weight).toBe("185");
  });
  it("an extra set and a workout with no plan copy forward", () => {
    expect(seed([row()], [logged({ weight: 190, reps: 9 })])).toMatchObject({ weight: "190", reps: "9" });
    expect(seed([], [logged({ weight: 190, reps: 9 })])).toMatchObject({ weight: "190", reps: "9" });
  });
  it("RPE stays blank when values carry", () => {
    expect(seed([row(), row()], [logged({ weight: 190, rpe: 8 })]).rpe).toBe("");
  });
  it("the reducer's post-log path and the re-seed path agree", () => {
    const reduce = createDraftReducer(() => "fresh");
    const plan = [row(RANGE), row(RANGE), row(RANGE)];
    const first = logged({ weight: 190, reps: 8 });
    const start = seed(plan, []);
    const afterLog = reduce(start, { type: "logged", set: first, plannedSets: plan, sets: [] });
    expect(afterLog).toMatchObject({ weight: "190", reps: "8" });
    expect(reduce(start, { type: "seed", plannedSets: plan, sets: [first], defaults: LB })).toEqual(afterLog);
  });
});
