import { describe, expect, it } from "vitest";
import type { PlanRowText } from "./planRows";
import { CHECK_THIS_SET, planRowSummary, SET_TYPE_CHOICES } from "./planRowSummary";

const row = (o: Partial<PlanRowText> = {}): PlanRowText => ({ key: "k", setType: "working", reps: "8", weight: "40", weightUnit: "kg", ...o });
const both = { showReps: true, showWeight: true } as const;

describe("17.11 AC11 — planRowSummary: one line per planned set", () => {
  it.each<[string, PlanRowText, Parameters<typeof planRowSummary>[1], string]>([
    ["a warm-up with reps and weight", row({ setType: "warmup" }), { n: 1, ...both, unit: "kg" }, "1 · Warm-up · 8 reps · 40 kg"],
    ["a single rep is 'rep', not 'reps'", row({ reps: "1", weight: "140" }), { n: 2, ...both, unit: "kg" }, "2 · Working · 1 rep · 140 kg"],
    ["a range that ends above one stays plural", row({ reps: "1-3" }), { n: 1, ...both, unit: "kg" }, "1 · Working · 1-3 reps · 40 kg"],
    ["a rep range in lb", row({ reps: "6-8", weight: "47.5", weightUnit: "lb" }), { n: 2, ...both, unit: "lb" }, "2 · Working · 6-8 reps · 47.5 lb"],
    ["both fields blank", row({ reps: "", weight: "" }), { n: 3, ...both, unit: "kg" }, "3 · Working · – · –"],
    ["whitespace only reads as blank", row({ reps: "  ", weight: " " }), { n: 3, ...both, unit: "kg" }, "3 · Working · – · –"],
    ["a timed exercise (no reps, no weight)", row(), { n: 2, showReps: false, showWeight: false, unit: "kg" }, "2 · Working"],
    ["no weight shown", row(), { n: 1, showReps: true, showWeight: false, unit: "kg" }, "1 · Working · 8 reps"],
    ["no reps shown", row(), { n: 1, showReps: false, showWeight: true, unit: "kg" }, "1 · Working · 40 kg"],
    ["mixed units: the row's own lb", row({ weightUnit: "lb" }), { n: 1, ...both, unit: "mixed" }, "1 · Working · 8 reps · 40 lb"],
    ["mixed units with no row unit: no fallback, no unit", row({ weightUnit: null }), { n: 1, ...both, unit: "mixed" }, "1 · Working · 8 reps · 40"],
    // Minor 519 (17.11 AC13): a row with no unit yet shows the unit Done will save it in.
    ["mixed units with no row unit: the fallback unit", row({ weightUnit: null }), { n: 1, ...both, unit: "mixed", fallbackUnit: "kg" }, "1 · Working · 8 reps · 40 kg"],
    ["mixed units: a row's own unit wins over the fallback", row({ weightUnit: "lb" }), { n: 1, ...both, unit: "mixed", fallbackUnit: "kg" }, "1 · Working · 8 reps · 40 lb"],
    ["the sheet's lb over a row without a unit", row({ weightUnit: null }), { n: 1, ...both, unit: "lb" }, "1 · Working · 8 reps · 40 lb"],
    ["the sheet's lb over a row in kg", row({ weightUnit: "kg" }), { n: 1, ...both, unit: "lb" }, "1 · Working · 8 reps · 40 lb"],
    ["reps that don't parse show as typed, without 'reps'", row({ reps: "abc" }), { n: 1, ...both, unit: "kg" }, "1 · Working · abc · 40 kg"],
    ["a weight that doesn't parse shows as typed, without a unit", row({ weight: "4o" }), { n: 1, ...both, unit: "kg" }, "1 · Working · 8 reps · 4o"],
    ["typed text is shown as stored, not reformatted", row({ reps: " 8 ", weight: "40,5" }), { n: 1, ...both, unit: "kg" }, "1 · Working · 8 reps · 40,5 kg"],
  ])("%s", (_name, r, options, expected) => {
    expect(planRowSummary(r, options)).toBe(expected);
  });

  it("names each set type with the 05.1 wording", () => {
    expect(SET_TYPE_CHOICES.map((c) => planRowSummary(row({ setType: c.value }), { n: 1, showReps: false, showWeight: false, unit: "kg" }))).toEqual([
      "1 · Warm-up",
      "1 · Working",
      "1 · Drop",
      "1 · Failure",
    ]);
  });

  it("has the words for a row that needs a look", () => {
    expect(CHECK_THIS_SET).toBe("Check this set");
  });
});
