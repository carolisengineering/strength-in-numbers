import { describe, expect, it } from "vitest";

import { barMode, unloggedPlanned, type PlannedRow } from "./unloggedPlanned";

const r = (id: string, planned: number, logged: number): PlannedRow => ({
  exercise: { id, exerciseNameSnapshot: id.toUpperCase(), plannedSets: Array.from({ length: planned }), sets: Array.from({ length: logged }) },
});

describe("17.1 AC33 — unloggedPlanned lists what End early would skip (positional)", () => {
  it("counts per exercise in display order, skipping done, open and over-logged ones", () => {
    expect(unloggedPlanned([r("a", 4, 4), r("b", 3, 0), r("c", 0, 2), r("d", 3, 1), r("e", 2, 5)])).toEqual({
      total: 5,
      planned: 12,
      byExercise: [
        { id: "b", name: "B", count: 3 },
        { id: "d", name: "D", count: 2 },
      ],
    });
  });
});

describe("17.1 AC27 — barMode", () => {
  it.each<[string, PlannedRow[], string | null, string]>([
    ["no exercises: add", [], null, "add"],
    ["planned sets left: log", [r("a", 2, 1)], "a", "log"],
    ["all planned logged, current has a plan: finish", [r("a", 2, 2), r("b", 1, 1)], "a", "finish"],
    ["queued sets count as logged (they are in sets): finish", [r("a", 1, 1)], "a", "finish"],
    ["all planned logged but current is open: log", [r("a", 2, 2), r("b", 0, 1)], "b", "log"],
    ["no planned sets anywhere: never finish", [r("a", 0, 3)], "a", "log"],
    ["extra sets do not unlock finish while another has sets left", [r("a", 1, 3), r("b", 2, 0)], "a", "log"],
  ])("%s", (_label, rows, currentId, expected) => {
    expect(barMode(rows, currentId)).toBe(expected);
  });
});
