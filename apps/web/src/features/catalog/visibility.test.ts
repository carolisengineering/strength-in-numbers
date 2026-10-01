import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import {
  filterByAttributes,
  pickRecents,
  searchByName,
  sortByName,
  visibleRows,
} from "./visibility";

const USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c";
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("AC4 — visibleRows hides retired rows", () => {
  it("excludes a row with isActive: false", () => {
    const active = makeExercise({ id: exerciseId(1), name: "Back Squat" });
    const retired = makeExercise({ id: exerciseId(2), name: "Old Lift", isActive: false });

    expect(names(visibleRows([active, retired]))).toEqual(["Back Squat"]);
  });
});

describe("AC5 — visibleRows hides forked origins", () => {
  const origin = makeExercise({ id: exerciseId(1), name: "Bench Press" });
  const other = makeExercise({ id: exerciseId(2), name: "Back Squat" });

  it("hides a global row that an active custom row was forked from, and keeps the fork", () => {
    const fork = makeExercise({
      id: exerciseId(3),
      name: "My Bench Press",
      ownerUserId: USER,
      forkedFromExerciseId: exerciseId(1),
    });

    expect(names(visibleRows([origin, other, fork])).sort()).toEqual([
      "Back Squat",
      "My Bench Press",
    ]);
  });

  it("keeps a global row nothing was forked from", () => {
    expect(names(visibleRows([origin, other])).sort()).toEqual(["Back Squat", "Bench Press"]);
  });

  it("does not hide the origin of a retired fork", () => {
    const retiredFork = makeExercise({
      id: exerciseId(3),
      ownerUserId: USER,
      forkedFromExerciseId: exerciseId(1),
      isActive: false,
    });

    expect(names(visibleRows([origin, retiredFork]))).toEqual(["Bench Press"]);
  });
});

describe("AC6 — sortByName sorts A–Z, accent- and case-insensitive", () => {
  it("interleaves case and accents by name", () => {
    const rows = ["Zercher Squat", "éclair Press", "Eclair Curl", "apple Row", "Apple Curl"].map(
      (name, i) => makeExercise({ id: exerciseId(i + 1), name }),
    );

    expect(names(sortByName(rows))).toEqual([
      "Apple Curl",
      "apple Row",
      "Eclair Curl",
      "éclair Press",
      "Zercher Squat",
    ]);
  });

  it("does not mutate its input", () => {
    const rows = [
      makeExercise({ id: exerciseId(1), name: "B" }),
      makeExercise({ id: exerciseId(2), name: "A" }),
    ];
    sortByName(rows);
    expect(names(rows)).toEqual(["B", "A"]);
  });
});

describe("AC7 — searchByName is a substring match on folded names", () => {
  const rows = [
    makeExercise({ id: exerciseId(1), name: "Café Curl" }),
    makeExercise({ id: exerciseId(2), name: "Back Squat" }),
  ];

  it("matches across accents and case", () => {
    expect(names(searchByName(rows, "cafe"))).toEqual(["Café Curl"]);
    expect(names(searchByName(rows, "CAFÉ"))).toEqual(["Café Curl"]);
    expect(names(searchByName(rows, "squ"))).toEqual(["Back Squat"]);
  });

  it("returns every row for an empty or whitespace-only query", () => {
    expect(searchByName(rows, "")).toHaveLength(2);
    expect(searchByName(rows, "   ")).toHaveLength(2);
  });

  it("trims the query", () => {
    expect(names(searchByName(rows, "  squat "))).toEqual(["Back Squat"]);
  });

  it("does not throw on punctuation, and treats a combining-mark-only query as empty", () => {
    expect(searchByName(rows, "(")).toEqual([]);
    expect(searchByName(rows, "[a-z]+")).toEqual([]);
    expect(searchByName(rows, "́")).toHaveLength(2);
  });
});

describe("AC8 — filterByAttributes filters by muscle and equipment", () => {
  const squat = makeExercise({
    id: exerciseId(1),
    name: "Back Squat",
    primaryMuscleId: "quads",
    secondaryMuscleIds: ["glutes"],
    equipmentId: "barbell",
  });
  const curl = makeExercise({
    id: exerciseId(2),
    name: "Dumbbell Curl",
    primaryMuscleId: "biceps",
    secondaryMuscleIds: [],
    equipmentId: "dumbbell",
  });
  const rows = [squat, curl];

  it("matches a muscle on the primary or any secondary entry", () => {
    expect(names(filterByAttributes(rows, { muscleId: "quads", equipmentId: null }))).toEqual([
      "Back Squat",
    ]);
    expect(names(filterByAttributes(rows, { muscleId: "glutes", equipmentId: null }))).toEqual([
      "Back Squat",
    ]);
  });

  it("matches equipment exactly", () => {
    expect(names(filterByAttributes(rows, { muscleId: null, equipmentId: "dumbbell" }))).toEqual([
      "Dumbbell Curl",
    ]);
  });

  it("ANDs both filters", () => {
    expect(filterByAttributes(rows, { muscleId: "quads", equipmentId: "dumbbell" })).toEqual([]);
  });

  it("null clears each filter", () => {
    expect(filterByAttributes(rows, { muscleId: null, equipmentId: null })).toHaveLength(2);
  });
});

describe("AC21 — pickRecents derives recents from the visible set", () => {
  const a = makeExercise({ id: exerciseId(1), name: "Zercher Squat" });
  const b = makeExercise({ id: exerciseId(2), name: "Apple Curl" });

  it("keeps recentIds order rather than re-sorting by name", () => {
    expect(names(pickRecents([b, a], [exerciseId(1), exerciseId(2)]))).toEqual([
      "Zercher Squat",
      "Apple Curl",
    ]);
  });

  it("omits an id that is not in the visible set", () => {
    expect(names(pickRecents([b], [exerciseId(1), exerciseId(2), exerciseId(99)]))).toEqual([
      "Apple Curl",
    ]);
  });
});
