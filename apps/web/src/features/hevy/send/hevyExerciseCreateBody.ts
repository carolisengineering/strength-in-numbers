import { HevyCreateTemplateBodySchema, sinEquipmentToHevy, sinMuscleToHevy, type HevyCreateTemplateBody, type HevyType } from "@sin/core";

/**
 * Spec 20.2 AC14, §6.5: the body of Hevy's create-exercise request, from a confirmed card. The muscle and equipment
 * inputs are SIN catalog ids, translated through 19.0's tables (`other` when unknown). Pure; throws on an empty title
 * (the schema's `title` alone would accept one) or any value the schema refuses.
 */
export function hevyExerciseCreateBody(input: {
  title: string;
  hevyType: HevyType;
  primaryMuscle: string | null;
  otherMuscles: readonly string[];
  equipment: string | null;
}): HevyCreateTemplateBody {
  const title = input.title.trim();
  if (title === "") throw new Error("A Hevy exercise needs a title");
  const primary = sinMuscleToHevy(input.primaryMuscle);
  const others = [...new Set(input.otherMuscles.map(sinMuscleToHevy))].filter((m) => m !== primary);
  return HevyCreateTemplateBodySchema.parse({
    exercise: {
      title,
      exercise_type: input.hevyType,
      muscle_group: primary,
      other_muscles: others,
      equipment_category: sinEquipmentToHevy(input.equipment),
    },
  });
}
