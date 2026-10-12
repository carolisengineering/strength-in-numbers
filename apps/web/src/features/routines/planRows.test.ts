import { describe, expect, it } from "vitest";
import { PLANNED_SETS_PER_ITEM_MAX } from "@sin/core";
import type { DraftSet } from "./routineDraft";
import {
  addRow,
  enterPlan,
  moveRow,
  parseRows,
  quickFromRows,
  removeRow,
  rowsFromPlan,
  setRowField,
  setUnit,
  unitOfRows,
  type PlanRowText,
} from "./planRows";

const row = (key: string, o: Partial<PlanRowText> = {}): PlanRowText => ({
  key,
  setType: "working",
  reps: "8",
  weight: "100",
  weightUnit: "kg",
  ...o,
});
let n = 0;
const mint = () => `new${++n}`;

describe("10.2 AC5 — enter plan mode", () => {
  it("makes `count` working rows copying the quick reps, weight and unit", () => {
    const rows = enterPlan({ count: 3, reps: "6-8", weight: "100", weightUnit: "kg" }, mint);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toMatchObject({ setType: "working", reps: "6-8", weight: "100", weightUnit: "kg" });
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });
  it("a blank set count makes one row (D11); the cap is 20", () => {
    expect(enterPlan({ count: null, reps: "", weight: "", weightUnit: null }, mint)).toHaveLength(1);
    expect(enterPlan({ count: 99, reps: "", weight: "", weightUnit: null }, mint)).toHaveLength(PLANNED_SETS_PER_ITEM_MAX);
  });
});

describe("10.2 AC5 — add row", () => {
  it("appends a working row copying the last row's reps, weight and unit", () => {
    const rows = [row("a", { reps: "10", weight: "60", setType: "warmup" }), row("b", { reps: "6", weight: "100" })];
    const next = addRow(rows, "c");
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ key: "c", setType: "working", reps: "6", weight: "100", weightUnit: "kg" });
  });
  it("is a no-op (same reference) at 20 rows", () => {
    const full = Array.from({ length: PLANNED_SETS_PER_ITEM_MAX }, (_, i) => row(`r${i}`));
    expect(addRow(full, "x")).toBe(full);
  });
});

describe("10.2 AC5 — remove row", () => {
  it("removes the named row", () => {
    expect(removeRow([row("a"), row("b")], "a").map((r) => r.key)).toEqual(["b"]);
  });
  it("is a no-op on the only row and on an unknown key (never zero rows, D11)", () => {
    const one = [row("a")];
    expect(removeRow(one, "a")).toBe(one);
    const two = [row("a"), row("b")];
    expect(removeRow(two, "zzz")).toBe(two);
  });
});

describe("10.2 AC5 — move row", () => {
  const rows = [row("a"), row("b"), row("c")];
  it.each([
    ["b", -1, ["b", "a", "c"]],
    ["b", 1, ["a", "c", "b"]],
    ["c", -1, ["a", "c", "b"]],
  ] as const)("move %s by %i → %j", (key, dir, order) => {
    expect(moveRow(rows, key, dir).map((r) => r.key)).toEqual(order);
  });
  it("is a no-op at the edges and for an unknown key", () => {
    expect(moveRow(rows, "a", -1)).toBe(rows);
    expect(moveRow(rows, "c", 1)).toBe(rows);
    expect(moveRow(rows, "zzz", 1)).toBe(rows);
  });
});

describe("10.2 AC5 — set row field", () => {
  const rows = [row("a"), row("b")];
  it("changes only the named row", () => {
    const next = setRowField(rows, "b", { reps: "5", setType: "drop" });
    expect(next[0]).toBe(rows[0]);
    expect(next[1]).toMatchObject({ key: "b", reps: "5", setType: "drop", weight: "100" });
  });
  it("is a no-op (same reference) when the value is unchanged", () => {
    expect(setRowField(rows, "a", { reps: "8" })).toBe(rows);
    expect(setRowField(rows, "zzz", { reps: "1" })).toBe(rows);
  });
});

describe("10.2 AC5 / D3 — set unit relabels every row without converting", () => {
  it("relabels all rows and leaves the numbers alone", () => {
    const rows = [row("a", { weightUnit: "kg" }), row("b", { weightUnit: "lb", weight: "225" })];
    const next = setUnit(rows, "lb");
    expect(next.map((r) => [r.weight, r.weightUnit])).toEqual([["100", "lb"], ["225", "lb"]]);
  });
  it("is a no-op when every row already has the unit", () => {
    const rows = [row("a"), row("b")];
    expect(setUnit(rows, "kg")).toBe(rows);
  });
});

describe("10.2 AC13 / D3 — the unit of a set of rows", () => {
  it.each([
    [[row("a"), row("b")], "kg"],
    [[row("a", { weightUnit: "lb" }), row("b", { weightUnit: "lb" })], "lb"],
    [[row("a"), row("b", { weightUnit: "lb" })], "mixed"],
    [[row("a", { weight: "", weightUnit: null }), row("b", { weight: "", weightUnit: null })], null],
    [[row("a", { weight: "", weightUnit: "kg" }), row("b", { weightUnit: "lb" })], "lb"], // rows without a weight do not vote
  ])("%j → %s", (rows, expected) => {
    expect(unitOfRows(rows)).toBe(expected);
  });
});

describe("10.2 AC16 — parseRows", () => {
  it("parses reps ranges and weights; a unit only travels with a weight", () => {
    const parsed = parseRows([row("a", { reps: "8-10", weight: "62,5" }), row("b", { reps: "", weight: "", weightUnit: "lb" })], "kg");
    expect(parsed).toEqual({
      ok: true,
      rows: [
        { key: "a", setType: "working", repsLow: 8, repsHigh: 10, weight: 62.5, weightUnit: "kg" },
        { key: "b", setType: "working", repsLow: null, repsHigh: null, weight: null, weightUnit: null },
      ],
    });
  });
  it("uses the fallback unit when a row has a weight but no unit", () => {
    const parsed = parseRows([row("a", { weightUnit: null })], "lb");
    expect(parsed.ok && parsed.rows[0]!.weightUnit).toBe("lb");
  });
  it("collects every row's errors by key, in static wording", () => {
    const parsed = parseRows([row("a", { reps: "9-3" }), row("b"), row("c", { weight: "abc" })], "kg");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect([...parsed.errors.keys()]).toEqual(["a", "c"]);
    expect(parsed.errors.get("a")?.reps).toMatch(/Enter reps/);
    expect(parsed.errors.get("c")?.weight).toMatch(/Enter a weight/);
    expect(JSON.stringify([...parsed.errors])).not.toContain("abc");
  });
});

describe("10.2 AC14 — back to the quick line only when lossless", () => {
  it("uniform working rows collapse to sets, reps and weight of the first row", () => {
    expect(quickFromRows([row("a"), row("b"), row("c")], "kg")).toEqual({ sets: "3", reps: "8", weight: "100", weightUnit: "kg" });
    expect(quickFromRows([row("a", { reps: "6-8", weight: "", weightUnit: null })], "kg")).toEqual({ sets: "1", reps: "6-8", weight: "", weightUnit: null });
  });
  it.each([
    ["a ramp", [row("a", { weight: "60" }), row("b", { weight: "100" })]],
    ["a warm-up", [row("a", { setType: "warmup" }), row("b")]],
    ["different reps", [row("a", { reps: "5" }), row("b", { reps: "8" })]],
    ["different units", [row("a"), row("b", { weightUnit: "lb" })]],
    ["unparsable text", [row("a", { reps: "x" })]],
  ])("refuses %s", (_name, rows) => {
    expect(quickFromRows(rows, "kg")).toBeNull();
  });
});

describe("rowsFromPlan", () => {
  it("formats a plan back into sheet text", () => {
    const plan: DraftSet[] = [
      { key: "a", setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60, weightUnit: "kg" },
      { key: "b", setType: "working", repsLow: 6, repsHigh: 8, weight: null, weightUnit: null },
    ];
    expect(rowsFromPlan(plan)).toEqual([
      { key: "a", setType: "warmup", reps: "10", weight: "60", weightUnit: "kg" },
      { key: "b", setType: "working", reps: "6-8", weight: "", weightUnit: null },
    ]);
  });
});
