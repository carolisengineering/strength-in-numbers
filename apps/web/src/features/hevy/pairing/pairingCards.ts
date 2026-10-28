import {
  CreateExerciseSchema,
  exerciseFromHevyTemplate,
  hevyPairingProblem,
  matchExerciseName,
  type CreateExercise,
  type Exercise,
  type HevyTemplate,
  type HevyType,
  type MeasureRule,
} from "@sin/core";

import { EMPTY_EXERCISE_FIELDS, toCreateExerciseInput, type ExerciseFieldValues } from "../../catalog/ExerciseFields";
import { MODALITY_LABELS } from "../../catalog/labels";
import { duplicateNewNameKeys, newNameProblem } from "../../catalog/newExerciseName";
import { HEVY_TYPE_LABELS } from "../labels";
import { fixableRule } from "../mapping/resolveLines";

/**
 * Spec 20.0 AC26, AC27, §6.6, pure: the Check-names pattern for Hevy exercises. One card per Hevy template that needs
 * a SIN exercise: an existing one (matched or chosen), a new one (prefilled from the template, 19.1 AC12), or Skip. A
 * measure rule is proposed (the box starts ticked) and never applied without the box. Nothing here writes anything.
 */

export interface PairingNeed {
  template: HevyTemplate;
  /** How often the template is used, for the card's "Used in …" line (20.1 counts it). */
  context?: { workouts: number; routines: number };
  /** The template is in the history but no longer in Hevy's list (20.1 AC32). */
  missing?: true;
}

export interface PairingCard {
  templateId: string;
  index: number;
  title: string;
  /** `null` for a type SIN does not support: the card can only Skip. */
  hevyType: HevyType | null;
  context?: PairingNeed["context"];
  match: { kind: "exact" | "similar"; exerciseId: string } | null;
  pickedId: string | null;
  selected: "match" | "picked" | "new" | "skip";
  newValue: ExerciseFieldValues;
  rule: MeasureRule | null;
  ruleSuggested: MeasureRule | null;
  detailsOpen: boolean;
}

export type PairingProblem =
  | { kind: "type"; hevyLabel: string; modalityLabel: string }
  | { kind: "rule_needed"; rule: MeasureRule }
  | { kind: "name"; message: string }
  | { kind: "same-new" }
  | { kind: "invalid" }
  | { kind: "gone" }
  /** The template's Hevy type has no SIN modality; only Skip is possible. */
  | { kind: "unsupported" };

export type PairingDecision =
  | { template: HevyTemplate; action: "pair"; exerciseId: string; rule: MeasureRule | null }
  | { template: HevyTemplate; action: "create"; create: CreateExercise; rule: MeasureRule | null }
  | { template: HevyTemplate; action: "skip" };

/** Gap 5: an exact or similar match; failing both, the title without a trailing parenthetical counts as similar. */
function matchFor(title: string, visible: readonly Exercise[]): PairingCard["match"] {
  const found = matchExerciseName(title, visible);
  if (found.kind !== "none") return { kind: found.kind, exerciseId: found.row.id };
  const bare = title.replace(/\s*\([^()]*\)\s*$/, "");
  if (bare === title || bare.trim() === "") return null;
  const again = matchExerciseName(bare, visible);
  return again.kind === "none" ? null : { kind: "similar", exerciseId: again.row.id };
}

export function initialPairingCards(needs: readonly PairingNeed[], visible: readonly Exercise[]): PairingCard[] {
  return needs.map(({ template, context }, index) => {
    const prefill = exerciseFromHevyTemplate(template);
    const match = template.type === null ? null : matchFor(template.title, visible);
    const newValue: ExerciseFieldValues = prefill
      ? {
          name: prefill.input.name,
          modality: prefill.input.modality,
          primaryMuscleId: prefill.input.primaryMuscleId ?? "",
          secondaryMuscleIds: prefill.input.secondaryMuscleIds ?? [],
          equipmentId: prefill.input.equipmentId ?? "",
        }
      : { ...EMPTY_EXERCISE_FIELDS, name: template.title.trim() };
    const ruleSuggested = prefill?.suggestedRule ?? null;
    return {
      templateId: template.id,
      index,
      title: template.title,
      hevyType: template.type,
      ...(context ? { context } : {}),
      match,
      pickedId: null,
      selected: template.type === null ? "skip" : match ? "match" : "new",
      newValue,
      rule: ruleSuggested,
      ruleSuggested,
      detailsOpen: false,
    };
  });
}

export const chooseMatch = (card: PairingCard): PairingCard => ({ ...card, selected: "match" });
export const chooseExisting = (card: PairingCard, exercise: Exercise): PairingCard => ({ ...card, pickedId: exercise.id, selected: "picked" });
export const chooseNew = (card: PairingCard): PairingCard => ({ ...card, selected: "new" });
export const chooseSkip = (card: PairingCard): PairingCard => ({ ...card, selected: "skip" });
export const setRule = (card: PairingCard, rule: MeasureRule | null): PairingCard => ({ ...card, rule });
export const setNewValue = (card: PairingCard, newValue: ExerciseFieldValues): PairingCard => ({ ...card, newValue });

/** The SIN exercise id the card points at, or `undefined` for New / Skip. */
function chosenId(card: PairingCard): string | null | undefined {
  if (card.selected === "match") return card.match?.exerciseId ?? null;
  if (card.selected === "picked") return card.pickedId;
  return undefined;
}

/** AC27: what blocks this card, or `null`. Same-new needs the other cards; `validity` adds it. */
export function problemFor(card: PairingCard, visible: readonly Exercise[]): PairingProblem | null {
  if (card.selected === "skip") return null;
  if (card.hevyType === null) return { kind: "unsupported" };
  let modality = card.newValue.modality;
  const id = chosenId(card);
  if (id !== undefined) {
    const row = id === null ? undefined : visible.find((e) => e.id === id);
    if (row === undefined) return { kind: "gone" };
    modality = row.modality;
  } else {
    const message = newNameProblem(card.newValue.name);
    if (message !== null) return { kind: "name", message };
    if (!CreateExerciseSchema.safeParse(toCreateExerciseInput(card.newValue)).success || modality === null) return { kind: "invalid" };
  }
  if (hevyPairingProblem(card.hevyType, modality, card.rule) === null) return null;
  const fix = fixableRule(card.hevyType, modality);
  if (fix !== null) return { kind: "rule_needed", rule: fix };
  return { kind: "type", hevyLabel: HEVY_TYPE_LABELS[card.hevyType], modalityLabel: MODALITY_LABELS[modality] };
}

/** AC27: every card's problem, plus "same New name on two cards". */
export function validity(cards: readonly PairingCard[], visible: readonly Exercise[]): { valid: boolean; problems: ReadonlyMap<string, PairingProblem> } {
  const problems = new Map<string, PairingProblem>();
  for (const card of cards) {
    const problem = problemFor(card, visible);
    if (problem !== null) problems.set(card.templateId, problem);
  }
  const fresh = cards.filter((c) => c.selected === "new");
  const repeated = duplicateNewNameKeys(fresh.map((c) => c.newValue.name));
  fresh.forEach((card, i) => {
    if (repeated.has(i) && !problems.has(card.templateId)) problems.set(card.templateId, { kind: "same-new" });
  });
  return { valid: problems.size === 0, problems };
}

/** §6.6: what the cards ask for, one decision per card in order (call only when `validity` is valid). */
export function decisionsOf(cards: readonly PairingCard[], needs: readonly PairingNeed[]): PairingDecision[] {
  const templates = new Map(needs.map((n) => [n.template.id, n.template]));
  return cards.map((card): PairingDecision => {
    const template = templates.get(card.templateId)!;
    if (card.selected === "skip") return { template, action: "skip" };
    const id = chosenId(card);
    if (id !== undefined && id !== null) return { template, action: "pair", exerciseId: id, rule: card.rule };
    return { template, action: "create", create: CreateExerciseSchema.parse(toCreateExerciseInput(card.newValue)), rule: card.rule };
  });
}
