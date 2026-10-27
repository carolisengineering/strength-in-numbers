import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HEVY_EQUIPMENT_TO_SIN,
  HEVY_EQUIPMENT_VALUES,
  HEVY_MUSCLE_TO_SIN,
  HEVY_MUSCLE_VALUES,
  SIN_EQUIPMENT_TO_HEVY,
  SIN_MUSCLE_TO_HEVY,
  hevyEquipmentToSin,
  hevyMuscleToSin,
  sinEquipmentToHevy,
  sinMuscleToHevy,
} from "../src/index.js";

const catalogIds = (file: string): string[] =>
  (JSON.parse(readFileSync(new URL(`../../../apps/api/prisma/catalog/${file}`, import.meta.url), "utf8")) as { id: string }[]).map((r) => r.id);

describe("19.0 AC15 — reference tables (§6.8)", () => {
  it("Hevy muscle → SIN, every one of Hevy's 20", () => {
    expect(HEVY_MUSCLE_TO_SIN).toEqual({
      abdominals: "core",
      shoulders: "shoulders",
      biceps: "biceps",
      triceps: "triceps",
      forearms: null,
      quadriceps: "quads",
      hamstrings: "hamstrings",
      calves: "calves",
      glutes: "glutes",
      abductors: null,
      adductors: null,
      lats: "lats",
      upper_back: "back",
      traps: null,
      lower_back: "back",
      chest: "chest",
      cardio: null,
      neck: null,
      full_body: null,
      other: null,
    });
    expect(Object.keys(HEVY_MUSCLE_TO_SIN).sort()).toEqual([...HEVY_MUSCLE_VALUES].sort());
  });

  it("SIN muscle → Hevy covers exactly the catalog's muscles", () => {
    expect(SIN_MUSCLE_TO_HEVY).toEqual({
      chest: "chest",
      back: "upper_back",
      lats: "lats",
      shoulders: "shoulders",
      biceps: "biceps",
      triceps: "triceps",
      core: "abdominals",
      quads: "quadriceps",
      hamstrings: "hamstrings",
      glutes: "glutes",
      calves: "calves",
    });
    expect(Object.keys(SIN_MUSCLE_TO_HEVY).sort()).toEqual(catalogIds("muscle-groups.json").sort());
  });

  it("Hevy equipment → SIN, every one of Hevy's 9", () => {
    expect(HEVY_EQUIPMENT_TO_SIN).toEqual({
      none: "bodyweight",
      barbell: "barbell",
      dumbbell: "dumbbell",
      kettlebell: "kettlebell",
      machine: "machine",
      plate: null,
      resistance_band: null,
      suspension: null,
      other: null,
    });
    expect(Object.keys(HEVY_EQUIPMENT_TO_SIN).sort()).toEqual([...HEVY_EQUIPMENT_VALUES].sort());
  });

  it("SIN equipment → Hevy covers exactly the catalog's equipment; cable is other", () => {
    expect(SIN_EQUIPMENT_TO_HEVY).toEqual({ barbell: "barbell", dumbbell: "dumbbell", kettlebell: "kettlebell", cable: "other", machine: "machine", bodyweight: "none" });
    expect(Object.keys(SIN_EQUIPMENT_TO_HEVY).sort()).toEqual(catalogIds("equipment.json").sort());
  });

  it("the helpers: unknown Hevy values are null; a missing or unknown SIN muscle is other", () => {
    expect(hevyMuscleToSin("forearms")).toBe(null);
    expect(hevyMuscleToSin("not_a_muscle")).toBe(null);
    expect(hevyMuscleToSin("quadriceps")).toBe("quads");
    expect(sinMuscleToHevy(null)).toBe("other");
    expect(sinMuscleToHevy("unknown")).toBe("other");
    expect(sinMuscleToHevy("core")).toBe("abdominals");
    expect(hevyEquipmentToSin("trap_bar")).toBe(null);
    expect(hevyEquipmentToSin("none")).toBe("bodyweight");
    expect(sinEquipmentToHevy(null)).toBe("other");
    expect(sinEquipmentToHevy("cable")).toBe("other");
  });
});
