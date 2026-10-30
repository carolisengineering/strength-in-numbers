import {
  exportPairFor,
  HEVY_TYPE_VALUES,
  hevyPairingProblem,
  hevyTypeForModality,
  type HevyMapping,
  type HevyPairInput,
  type HevyTemplate,
  type HevyType,
  type MeasureRule,
  type Modality,
  type UnmappedExercise,
} from "@sin/core";

/**
 * Spec 20.2 AC13 / AC14, §6.5: the "Match exercises for Hevy" cards as a pure model — one card per unmapped exercise,
 * each picked, created in Hevy, or left out of this send. Pure.
 */

export interface CreateDraft {
  title: string;
  hevyType: HevyType;
  /** SIN catalog ids, translated only by `hevyExerciseCreateBody`. */
  primaryMuscle: string | null;
  otherMuscles: string[];
  equipment: string | null;
}

export type CardChoice =
  | null
  | { kind: "pick"; template: HevyTemplate }
  | { kind: "create"; draft: CreateDraft; created?: { id: string } }
  | { kind: "leave" };

export interface ExportCard {
  exercise: UnmappedExercise;
  choice: CardChoice;
}

/** D5: a Calories exercise goes to Hevy as reps (`calories_as_reps`); nothing else carries a rule. */
const ruleFor = (modality: Modality): MeasureRule | null => (modality === "calories" ? "calories_as_reps" : null);

/** A card for each unmapped exercise that still has no export pair (one may have appeared since the build). */
export function initialExportCards(unmapped: readonly UnmappedExercise[], mapping: HevyMapping, rootOf: (id: string) => string): ExportCard[] {
  return unmapped.filter((e) => exportPairFor(e.exerciseId, mapping, rootOf, e.modality) === null).map((exercise) => ({ exercise, choice: null }));
}

/** AC13: the Hevy templates this exercise's sets can go to (a template of unknown type never can). */
export function acceptableTemplates(templates: readonly HevyTemplate[], modality: Modality): HevyTemplate[] {
  return templates.filter((t) => t.type !== null && hevyPairingProblem(t.type, modality, ruleFor(modality)) === null);
}

/** AC14: the Hevy types a created exercise may take for this modality. */
export function allowedHevyTypes(modality: Modality): HevyType[] {
  return HEVY_TYPE_VALUES.filter((t) => hevyPairingProblem(t, modality, ruleFor(modality)) === null);
}

/** AC14: the create step's prefill — the SIN name (` (calories)` for Calories, D5), the matching type, the row's muscles and equipment. */
export function createDraftFor(
  exercise: UnmappedExercise,
  row: { primaryMuscleId: string | null; secondaryMuscleIds: readonly string[]; equipmentId: string | null } | undefined,
): CreateDraft {
  return {
    title: exercise.modality === "calories" ? `${exercise.name} (calories)` : exercise.name,
    hevyType: hevyTypeForModality(exercise.modality),
    primaryMuscle: row?.primaryMuscleId ?? null,
    otherMuscles: [...(row?.secondaryMuscleIds ?? [])],
    equipment: row?.equipmentId ?? null,
  };
}

/** AC13: Continue needs every card chosen, and every create made in Hevy. */
export function canContinue(cards: readonly ExportCard[]): boolean {
  return cards.every((c) => c.choice !== null && (c.choice.kind !== "create" || c.choice.created !== undefined));
}

/** AC13 / AC14: the pairs to save — an exercise's first pairing is its `exportAs` (19.0 AC24). */
export function upsertsFor(cards: readonly ExportCard[]): HevyPairInput[] {
  return cards.flatMap((c): HevyPairInput[] => {
    const base = { role: "exercise" as const, exerciseId: c.exercise.exerciseId, measureRule: ruleFor(c.exercise.modality), exportAs: true };
    if (c.choice?.kind === "pick") return [{ hevyTemplateId: c.choice.template.id, hevyTitle: c.choice.template.title, hevyType: c.choice.template.type, ...base }];
    if (c.choice?.kind === "create" && c.choice.created) {
      return [{ hevyTemplateId: c.choice.created.id, hevyTitle: c.choice.draft.title.trim(), hevyType: c.choice.draft.hevyType, ...base }];
    }
    return [];
  });
}

/** D2: the exercises left out of this send only (nothing is saved for them). */
export function leftOut(cards: readonly ExportCard[]): Set<string> {
  return new Set(cards.filter((c) => c.choice?.kind === "leave").map((c) => c.exercise.exerciseId));
}
