import { describe, expect, it } from "vitest";
import { makeSet } from "../../test/workoutFixtures";
import { diffForPatch, draftFromSet, parseDraft, unitDefaultsFor } from "./setDraft";

describe("18.1 AC9 — unit defaults", () => {
  it("a carry starts in meters whatever the profile; distance_duration keeps km / mi", () => {
    expect(unitDefaultsFor("lb", "weight_distance")).toEqual({ weightUnit: "lb", distanceUnit: "m" });
    expect(unitDefaultsFor("kg", "weight_distance")).toEqual({ weightUnit: "kg", distanceUnit: "m" });
    expect(unitDefaultsFor("lb", "distance_duration")).toEqual({ weightUnit: "lb", distanceUnit: "mi" });
    expect(unitDefaultsFor("kg")).toEqual({ weightUnit: "kg", distanceUnit: "km" });
  });
  it("a draft copied forward from a set logged in feet keeps feet", () => {
    const carry = makeSet({ reps: null, weight: 24, distance: 100, distanceUnit: "ft", distanceM: 30.48 });
    expect(draftFromSet(carry, unitDefaultsFor("kg", "weight_distance"), "k").distanceUnit).toBe("ft");
  });
});

describe("18.1 AC40 — feet in the draft", () => {
  it("a carry draft in ft parses to distanceUnit ft", () => {
    const d = { ...draftFromSet(null, unitDefaultsFor("kg", "weight_distance"), "k"), weight: "24", distance: "40", distanceUnit: "ft" as const };
    expect(parseDraft("weight_distance", d)).toEqual({ ok: true, body: { setType: "working", weight: 24, weightUnit: "kg", distance: 40, distanceUnit: "ft" } });
  });
  it("diffForPatch sends distanceUnit when it changes m → ft", () => {
    const carry = makeSet({ reps: null, weight: 24, distance: 40, distanceUnit: "m", distanceM: 40 });
    expect(diffForPatch(carry, { setType: "working", weight: 24, weightUnit: "kg", distance: 40, distanceUnit: "ft" })).toEqual({ distanceUnit: "ft" });
  });
});
