import type { PlannedSet } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { advanceAfterLog, chooseCurrent, lastLoggedId, progressOf, runOf } from "./currentExercise";
import { supersetRows } from "./supersetRows";

const T0 = "2026-10-02T10:00:00.000Z";
const T1 = "2026-10-02T10:05:00.000Z";
const planned = (n: number): PlannedSet[] =>
  Array.from({ length: n }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));

interface Spec {
  name: string;
  planned?: number;
  logged?: number;
  group?: number | null;
  section?: number | null;
  at?: string;
}

function rowsOf(specs: Spec[], sections = 0) {
  const detail = makeWorkoutDetail({
    sections: Array.from({ length: sections }, (_, i) => ({ name: `Section ${i + 1}` })),
    exercises: specs.map((s) => ({
      modality: "weight_reps" as const,
      name: s.name,
      plannedSets: planned(s.planned ?? 0),
      sets: Array.from({ length: s.logged ?? 0 }, (_, i) => makeSet({ setNumber: i + 1, createdAt: s.at ?? T0 })),
      supersetGroup: s.group ?? null,
      sectionIndex: s.section ?? null,
    })),
  });
  return supersetRows(detail.exercises);
}
const idOf = (rows: ReturnType<typeof rowsOf>, name: string) => rows.find((r) => r.exercise.exerciseNameSnapshot === name)!.exercise.id;
const nameOf = (rows: ReturnType<typeof rowsOf>, id: string | null) =>
  id === null ? null : (rows.find((r) => r.exercise.id === id)?.exercise.exerciseNameSnapshot ?? null);

describe("17.1 AC12 — progress is positional", () => {
  it("counts sets against plannedSets, never setNumber", () => {
    const rows = rowsOf([{ name: "A", planned: 4, logged: 2 }, { name: "B" }]);
    expect(progressOf(rows[0]!.exercise)).toEqual({ planned: 4, logged: 2, remaining: 2, open: false });
    expect(progressOf(rows[1]!.exercise)).toEqual({ planned: 0, logged: 0, remaining: 0, open: true });
    expect(progressOf(rowsOf([{ name: "C", planned: 2, logged: 3 }])[0]!.exercise).remaining).toBe(0);
  });

  it("runOf returns the maximal linked chain, or null outside a run", () => {
    const rows = rowsOf([{ name: "A", group: 1 }, { name: "B", group: 1 }, { name: "C" }]);
    expect(runOf(rows, idOf(rows, "B"))!.map((r) => r.exercise.exerciseNameSnapshot)).toEqual(["A", "B"]);
    expect(runOf(rows, idOf(rows, "C"))).toBeNull();
    expect(runOf(rows, "missing")).toBeNull();
  });
});

describe("17.1 AC12 — chooseCurrent is computed, not stored", () => {
  it.each<[string, Spec[], string | null]>([
    ["no exercises", [], null],
    ["no sets: the first exercise", [{ name: "A", planned: 2 }, { name: "B", planned: 2 }], "A"],
    ["no sets, free-form: the first", [{ name: "A" }, { name: "B" }], "A"],
    ["the open exercise last logged stays", [{ name: "A", logged: 1, at: T1 }, { name: "B", logged: 1, at: T0 }], "A"],
    ["equal createdAt: the later position wins", [{ name: "A", logged: 1 }, { name: "B", logged: 1 }], "B"],
    ["after the last planned set: the next", [{ name: "A", planned: 2, logged: 2, at: T1 }, { name: "B", planned: 2 }], "B"],
    ["a reloaded superset round: the next member", [{ name: "A", group: 1, planned: 3, logged: 1, at: T1 }, { name: "B", group: 1, planned: 3 }], "B"],
    ["nothing left anywhere: the last logged", [{ name: "A", planned: 1, logged: 1, at: T0 }, { name: "B", planned: 1, logged: 1, at: T1 }], "B"],
  ])("%s", (_label, specs, expected) => {
    const rows = rowsOf(specs);
    expect(nameOf(rows, chooseCurrent(rows, lastLoggedId(rows)))).toBe(expected);
  });

  it("an unknown lastLogged id is treated as no sets", () => {
    const rows = rowsOf([{ name: "A", planned: 1 }, { name: "B" }]);
    expect(nameOf(rows, chooseCurrent(rows, "not-here"))).toBe("A");
  });
});

describe("17.1 AC14 — auto-advance after a log", () => {
  it.each<[string, Spec[], string, boolean, string]>([
    ["(a) more planned sets: stays", [{ name: "A", planned: 3, logged: 1 }, { name: "B", planned: 2 }], "A", false, "A"],
    ["(b) last planned set: the next with sets left", [{ name: "A", planned: 2, logged: 2 }, { name: "B", planned: 2 }], "A", false, "B"],
    ["(b) skips done and open exercises", [{ name: "A", planned: 2, logged: 2 }, { name: "B" }, { name: "C", planned: 1, logged: 1 }, { name: "D", planned: 2 }], "A", false, "D"],
    ["(b) wraps to an earlier one", [{ name: "A", planned: 2 }, { name: "B", planned: 2, logged: 2 }], "B", false, "A"],
    ["(b) none left anywhere: stays", [{ name: "A", planned: 1, logged: 1 }, { name: "B", planned: 1, logged: 1 }], "B", false, "B"],
    ["(c) an extra set: stays", [{ name: "A", planned: 2, logged: 3 }, { name: "B", planned: 2 }], "A", true, "A"],
    ["(c) an open exercise: stays", [{ name: "A", logged: 1 }, { name: "B", planned: 2 }], "A", false, "A"],
    ["enters a run at its first member with sets left", [{ name: "X", planned: 1, logged: 1 }, { name: "A", group: 1, planned: 1, logged: 1 }, { name: "B", group: 1, planned: 2 }], "X", false, "B"],
  ])("%s", (_label, specs, logged, wasExtra, expected) => {
    const rows = rowsOf(specs);
    expect(nameOf(rows, advanceAfterLog({ rows, loggedId: idOf(rows, logged), wasExtra }))).toBe(expected);
  });

  it("an id that is not in the rows comes back unchanged", () => {
    const rows = rowsOf([{ name: "A" }]);
    expect(advanceAfterLog({ rows, loggedId: "gone", wasExtra: false })).toBe("gone");
  });
});

describe("17.1 AC15 — superset alternation", () => {
  it.each<[string, Spec[], string, string]>([
    ["A → B", [{ name: "A", group: 1, planned: 3, logged: 1 }, { name: "B", group: 1, planned: 3 }], "A", "B"],
    ["B → A (cyclic)", [{ name: "A", group: 1, planned: 3, logged: 1 }, { name: "B", group: 1, planned: 3, logged: 1 }], "B", "A"],
    ["skips a finished member", [{ name: "A", group: 1, planned: 3, logged: 1 }, { name: "B", group: 1, planned: 1, logged: 1 }, { name: "C", group: 1, planned: 3 }], "A", "C"],
    ["only the logged member has sets left: stays", [{ name: "A", group: 1, planned: 3, logged: 1 }, { name: "B", group: 1, planned: 1, logged: 1 }], "A", "A"],
    ["run done: the next after the run", [{ name: "A", group: 1, planned: 1, logged: 1 }, { name: "B", group: 1, planned: 1, logged: 1 }, { name: "C", planned: 2 }], "A", "C"],
    ["run done: wraps from the run's last member", [{ name: "X", planned: 2 }, { name: "A", group: 1, planned: 1, logged: 1 }, { name: "B", group: 1, planned: 1, logged: 1 }], "B", "X"],
    ["an open member takes part only as the logged one", [{ name: "A", group: 1, logged: 1 }, { name: "B", group: 1, planned: 2 }], "A", "B"],
    ["an extra set inside a run still alternates", [{ name: "A", group: 1, planned: 1, logged: 2 }, { name: "B", group: 1, planned: 2 }], "A", "B"],
  ])("%s", (_label, specs, logged, expected) => {
    const rows = rowsOf(specs);
    expect(nameOf(rows, advanceAfterLog({ rows, loggedId: idOf(rows, logged), wasExtra: false }))).toBe(expected);
  });

  it("never crosses a section boundary (supersetRows breaks the run there)", () => {
    const rows = rowsOf([{ name: "A", group: 1, section: 0, planned: 2, logged: 1 }, { name: "B", group: 1, section: 1, planned: 2 }], 2);
    expect(runOf(rows, idOf(rows, "A"))).toBeNull();
    expect(nameOf(rows, advanceAfterLog({ rows, loggedId: idOf(rows, "A"), wasExtra: false }))).toBe("A");
  });
});
