import type { Equipment, MuscleGroup } from "@sin/core";
import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { detailRows, type RefState } from "./detailRows";

const ME = "00000000-0000-4000-8000-0000000000aa";
const MUSCLES: RefState<MuscleGroup> = {
  status: "ok",
  rows: [
    { id: "chest", name: "Chest", displayOrder: 1 },
    { id: "triceps", name: "Triceps", displayOrder: 2 },
    { id: "shoulders", name: "Shoulders", displayOrder: 3 },
  ],
};
const EQUIPMENT: RefState<Equipment> = { status: "ok", rows: [{ id: "barbell", name: "Barbell", displayOrder: 1 }] };
const ctx = { muscles: MUSCLES, equipment: EQUIPMENT, origin: null };

const valueOf = (rows: ReturnType<typeof detailRows>, label: string) => rows.find((r) => r.label === label)?.value;

describe("18.2 AC21 — detailRows", () => {
  it("lists the five labels in order", () => {
    expect(detailRows(makeExercise(), ctx).map((r) => r.label)).toEqual([
      "Source",
      "Type",
      "Primary muscle",
      "Secondary muscles",
      "Equipment",
    ]);
  });

  it("names the source", () => {
    expect(valueOf(detailRows(makeExercise(), ctx), "Source")).toBe("Built-in exercise");
    expect(valueOf(detailRows(makeExercise({ ownerUserId: ME }), ctx), "Source")).toBe("Your exercise");
    const origin = makeExercise({ id: exerciseId(1), name: "Bench Press" });
    const fork = makeExercise({ id: exerciseId(2), ownerUserId: ME, forkedFromExerciseId: exerciseId(1) });
    expect(valueOf(detailRows(fork, { ...ctx, origin }), "Source")).toBe("Your copy of Bench Press");
    expect(valueOf(detailRows(fork, ctx), "Source")).toBe("Your copy of a built-in exercise");
  });

  it("reads the type label, muscle names in authoring order and the equipment", () => {
    const rows = detailRows(
      makeExercise({ modality: "calories", primaryMuscleId: "chest", secondaryMuscleIds: ["shoulders", "triceps"] }),
      ctx,
    );
    expect(valueOf(rows, "Type")).toBe("Calories");
    expect(valueOf(rows, "Primary muscle")).toBe("Chest");
    expect(valueOf(rows, "Secondary muscles")).toBe("Shoulders, Triceps");
    expect(valueOf(rows, "Equipment")).toBe("Barbell");
  });

  it("reads Not set for unset values", () => {
    const rows = detailRows(makeExercise({ primaryMuscleId: null, secondaryMuscleIds: [], equipmentId: null }), ctx);
    expect(valueOf(rows, "Primary muscle")).toBe("Not set");
    expect(valueOf(rows, "Secondary muscles")).toBe("Not set");
    expect(valueOf(rows, "Equipment")).toBe("Not set");
  });

  it("omits muscle and equipment values while their lists load", () => {
    const rows = detailRows(makeExercise({ secondaryMuscleIds: ["triceps"] }), {
      ...ctx,
      muscles: { status: "pending" },
      equipment: { status: "pending" },
    });
    expect(valueOf(rows, "Primary muscle")).toBeNull();
    expect(valueOf(rows, "Secondary muscles")).toBeNull();
    expect(valueOf(rows, "Equipment")).toBeNull();
  });

  it("omits nothing while loading when the value is unset", () => {
    const rows = detailRows(makeExercise({ primaryMuscleId: null, equipmentId: null }), {
      ...ctx,
      muscles: { status: "pending" },
      equipment: { status: "pending" },
    });
    expect(valueOf(rows, "Primary muscle")).toBe("Not set");
    expect(valueOf(rows, "Equipment")).toBe("Not set");
  });

  it("reads Unavailable when the lists failed", () => {
    const rows = detailRows(makeExercise({ secondaryMuscleIds: ["triceps"] }), {
      ...ctx,
      muscles: { status: "error" },
      equipment: { status: "error" },
    });
    expect(valueOf(rows, "Primary muscle")).toBe("Unavailable");
    expect(valueOf(rows, "Secondary muscles")).toBe("Unavailable");
    expect(valueOf(rows, "Equipment")).toBe("Unavailable");
  });

  it("reads Unavailable for an id missing from a loaded list (Review Focus 3)", () => {
    const rows = detailRows(
      makeExercise({ primaryMuscleId: "glutes", secondaryMuscleIds: ["chest", "calves"], equipmentId: "sled" }),
      ctx,
    );
    expect(valueOf(rows, "Primary muscle")).toBe("Unavailable");
    expect(valueOf(rows, "Secondary muscles")).toBe("Unavailable");
    expect(valueOf(rows, "Equipment")).toBe("Unavailable");
  });
});
