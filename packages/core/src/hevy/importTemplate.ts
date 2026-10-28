import type { HevyTemplate } from "../dto/hevy-api.js";
import { EXERCISE_NAME_MAX, MAX_SECONDARY_MUSCLE_IDS, type CreateExercise } from "../dto/exercise.js";
import type { Modality } from "../enums.js";
import { cleanLine } from "./importText.js";
import { canonicalModalityForHevyType, defaultMeasureRule } from "./pairing.js";
import { hevyEquipmentToSin, hevyMuscleToSin } from "./referenceTables.js";
import type { MeasureRule } from "./vocabulary.js";

/** The name a template gets when its Hevy title is blank after cleaning (`CreateExerciseSchema` needs one). */
const BLANK_EXERCISE_NAME = "Hevy exercise";

/**
 * Spec 19.1 AC12: a create-exercise prefill for a Hevy template, with the measure rule the pairing screen proposes
 * (the lifter confirms it; it is never applied silently). `null` for a type SIN does not support: such a template can
 * only be paired as a skip.
 */
export function exerciseFromHevyTemplate(t: HevyTemplate): { input: CreateExercise; suggestedRule: MeasureRule | null } | null {
  if (t.type === null) return null;
  let modality: Modality;
  let suggestedRule: MeasureRule | null = null;
  if (t.type === "bodyweight_assisted_reps") {
    modality = "bodyweight_reps";
    suggestedRule = "assist_weight_ignored";
  } else if (defaultMeasureRule(t.title, t.type) === "calories_as_reps") {
    modality = "calories";
    suggestedRule = "calories_as_reps";
  } else {
    modality = canonicalModalityForHevyType(t.type)!;
  }

  const primaryMuscleId = t.primary_muscle_group == null ? null : hevyMuscleToSin(t.primary_muscle_group);
  const secondary = new Set<string>();
  for (const muscle of t.secondary_muscle_groups ?? []) {
    const id = hevyMuscleToSin(muscle);
    if (id !== null && id !== primaryMuscleId) secondary.add(id);
  }

  return {
    input: {
      name: cleanLine(t.title, EXERCISE_NAME_MAX).value ?? BLANK_EXERCISE_NAME,
      modality,
      primaryMuscleId,
      secondaryMuscleIds: [...secondary].slice(0, MAX_SECONDARY_MUSCLE_IDS),
      equipmentId: t.equipment == null ? null : hevyEquipmentToSin(t.equipment),
    },
    suggestedRule,
  };
}
