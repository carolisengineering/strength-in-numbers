import type { HevyEquipment, HevyMuscle } from "../dto/hevy-api.js";

/**
 * Spec 19.0 AC15, §6.8: muscle and equipment names between Hevy and SIN's catalog ids. A Hevy value with no SIN
 * counterpart is `null` ("Not set"); a SIN value with none exports as Hevy's `other`.
 */
export const HEVY_MUSCLE_TO_SIN: Readonly<Record<HevyMuscle, string | null>> = Object.freeze({
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

/** Every SIN catalog muscle (`muscle-groups.json`), pinned against the catalog by a test. */
export const SIN_MUSCLE_TO_HEVY: Readonly<Record<string, HevyMuscle>> = Object.freeze({
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

export const HEVY_EQUIPMENT_TO_SIN: Readonly<Record<HevyEquipment, string | null>> = Object.freeze({
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

/** Every SIN catalog equipment id (`equipment.json`), pinned against the catalog by a test. */
export const SIN_EQUIPMENT_TO_HEVY: Readonly<Record<string, HevyEquipment>> = Object.freeze({
  barbell: "barbell",
  dumbbell: "dumbbell",
  kettlebell: "kettlebell",
  cable: "other",
  machine: "machine",
  bodyweight: "none",
});

const has = <T extends object>(table: T, key: string): key is Extract<keyof T, string> => Object.hasOwn(table, key);

/** A Hevy muscle (any string, as read) to a SIN muscle id, or `null` when there is none. */
export function hevyMuscleToSin(value: string): string | null {
  return has(HEVY_MUSCLE_TO_SIN, value) ? HEVY_MUSCLE_TO_SIN[value] : null;
}

/** A SIN muscle id to Hevy's; `other` for a missing or unknown one. */
export function sinMuscleToHevy(id: string | null): HevyMuscle {
  return id !== null && has(SIN_MUSCLE_TO_HEVY, id) ? SIN_MUSCLE_TO_HEVY[id]! : "other";
}

/** A Hevy equipment value to a SIN equipment id, or `null`. */
export function hevyEquipmentToSin(value: string): string | null {
  return has(HEVY_EQUIPMENT_TO_SIN, value) ? HEVY_EQUIPMENT_TO_SIN[value] : null;
}

/** A SIN equipment id to Hevy's; `other` for a missing or unknown one. */
export function sinEquipmentToHevy(id: string | null): HevyEquipment {
  return id !== null && has(SIN_EQUIPMENT_TO_HEVY, id) ? SIN_EQUIPMENT_TO_HEVY[id]! : "other";
}
