import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { pinTimeZone } from "../../test/timeZone";
import { visibleRows } from "../catalog/visibility";
import { buildExerciseRows, metaLine, type ExerciseRow } from "./exerciseRows";

const ME = "00000000-0000-4000-8000-0000000000aa";

const names = (rows: readonly ExerciseRow[]) => rows.map((r) => r.row.name);

describe("18.2 AC8 / AC9 — row model and sort", () => {
  it("puts logged rows first by date desc, then unlogged by name", () => {
    const a = makeExercise({ id: exerciseId(1), name: "Squat" });
    const b = makeExercise({ id: exerciseId(2), name: "Bench" });
    const c = makeExercise({ id: exerciseId(3), name: "Curl" });
    const d = makeExercise({ id: exerciseId(4), name: "Arnold press" });
    const usage = new Map([
      [exerciseId(1), "2026-10-01"],
      [exerciseId(3), "2026-10-20"],
    ]);
    expect(names(buildExerciseRows([a, b, c, d], usage))).toEqual([
      "Curl",
      "Squat",
      "Arnold press",
      "Bench",
    ]);
  });

  it("breaks equal dates by name, then by id", () => {
    const rows = [
      makeExercise({ id: exerciseId(3), name: "Row" }),
      makeExercise({ id: exerciseId(2), name: "Row" }),
      makeExercise({ id: exerciseId(1), name: "Press" }),
    ];
    const usage = new Map(rows.map((r) => [r.id, "2026-10-01"]));
    expect(buildExerciseRows(rows, usage).map((r) => r.row.id)).toEqual([
      exerciseId(1),
      exerciseId(2),
      exerciseId(3),
    ]);
  });

  it("compares names with the base-sensitivity collator", () => {
    const rows = [
      makeExercise({ id: exerciseId(2), name: "Éclair" }),
      makeExercise({ id: exerciseId(1), name: "eclair" }),
      makeExercise({ id: exerciseId(3), name: "Dip" }),
    ];
    // "Éclair" and "eclair" are equal under the collator, so the id decides.
    expect(buildExerciseRows(rows, new Map()).map((r) => r.row.id)).toEqual([
      exerciseId(3),
      exerciseId(1),
      exerciseId(2),
    ]);
  });

  it("lists every row A–Z for an empty usage map and ignores unknown roots", () => {
    const rows = [makeExercise({ id: exerciseId(1), name: "B" }), makeExercise({ id: exerciseId(2), name: "A" })];
    expect(names(buildExerciseRows(rows, new Map()))).toEqual(["A", "B"]);
    const stray = new Map([[exerciseId(99), "2026-10-01"]]);
    const built = buildExerciseRows(rows, stray);
    expect(names(built)).toEqual(["A", "B"]);
    expect(built.every((r) => r.lastLoggedOn === null)).toBe(true);
  });

  it("maps a fork to its built-in root, and never lists a hidden origin", () => {
    const builtin = makeExercise({ id: exerciseId(1), name: "Bench", ownerUserId: null });
    const fork = makeExercise({ id: exerciseId(2), name: "My bench", ownerUserId: ME, forkedFromExerciseId: exerciseId(1) });
    const otherBuiltin = makeExercise({ id: exerciseId(3), name: "Plank", ownerUserId: null, modality: "duration" });
    const otherFork = makeExercise({ id: exerciseId(4), name: "My plank", ownerUserId: ME, forkedFromExerciseId: exerciseId(3) });
    const usage = new Map([[exerciseId(1), "2026-10-05"]]);
    const built = buildExerciseRows(visibleRows([builtin, fork, otherBuiltin, otherFork]), usage);
    expect(built.map((r) => [r.row.name, r.lastLoggedOn])).toEqual([
      ["My bench", "2026-10-05"],
      ["My plank", null],
    ]);
  });

  it("lists the built-in with its date again once the fork is gone (03.4 D21)", () => {
    const builtin = makeExercise({ id: exerciseId(1), name: "Bench", ownerUserId: null });
    const usage = new Map([[exerciseId(1), "2026-10-05"]]);
    const built = buildExerciseRows(visibleRows([builtin]), usage);
    expect(built.map((r) => [r.row.name, r.lastLoggedOn])).toEqual([["Bench", "2026-10-05"]]);
  });

  it("marks source builtin iff ownerUserId is null", () => {
    const rows = [
      makeExercise({ id: exerciseId(1), name: "A", ownerUserId: null }),
      makeExercise({ id: exerciseId(2), name: "B", ownerUserId: ME }),
      makeExercise({ id: exerciseId(3), name: "C", ownerUserId: ME, forkedFromExerciseId: exerciseId(9) }),
    ];
    expect(buildExerciseRows(rows, new Map()).map((r) => r.source)).toEqual(["builtin", "yours", "yours"]);
  });
});

describe("18.2 AC10 — row text", () => {
  pinTimeZone("Europe/London");
  const TODAY = "2026-10-25";
  const item = (over: Partial<ExerciseRow> & { modality?: string; ownerUserId?: string | null }): ExerciseRow => ({
    row: makeExercise({ modality: over.modality ?? "weight_reps", ownerUserId: over.ownerUserId ?? null }),
    lastLoggedOn: over.lastLoggedOn ?? null,
    source: over.source ?? (over.ownerUserId ? "yours" : "builtin"),
  });

  it("reads Last logged with the day in the current year", () => {
    expect(metaLine(item({ lastLoggedOn: "2026-10-24", modality: "calories" }), TODAY, true)).toBe(
      "Last logged Sat 24 Oct · Calories",
    );
  });

  it("adds the year for another year", () => {
    expect(metaLine(item({ lastLoggedOn: "2025-06-16", modality: "bodyweight_reps" }), TODAY, true)).toBe(
      "Last logged Mon 16 Jun 2025 · Bodyweight × reps",
    );
  });

  it("reads Built in or Yours when never logged", () => {
    expect(metaLine(item({ modality: "duration" }), TODAY, true)).toBe("Built in · Duration");
    expect(metaLine(item({ ownerUserId: ME }), TODAY, true)).toBe("Yours · Weight × reps");
  });

  it("shows only the type when usage is unknown", () => {
    expect(metaLine(item({ lastLoggedOn: null }), TODAY, false)).toBe("Weight × reps");
  });
});
