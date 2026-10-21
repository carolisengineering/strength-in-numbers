import {
  CatalogName,
  CreateExerciseSchema,
  buildImportPlan,
  guessModality,
  matchExerciseName,
  normalizeExerciseName,
  type Exercise,
  type ReadName,
  type ReadResult,
} from "@sin/core";

import { EMPTY_EXERCISE_FIELDS, toCreateExerciseInput, type ExerciseFieldValues } from "../../catalog/ExerciseFields";
import { NEW_NAME_INVALID, NEW_NAME_REQUIRED, NEW_NAME_TOO_LONG } from "./messages";

/**
 * Spec 10.4 AC24–AC27, pure: one card per distinct name, its pre-decided choice, and what blocks a New
 * card. The screens hold an array of these in the import session.
 */
export interface CardState {
  /** normalizeExerciseName(written). */
  readonly key: string;
  /** DOM ids: `import-card-${index}`. */
  readonly index: number;
  /** First occurrence, as written. */
  readonly written: string;
  /** Section names; [] for loose-only. */
  readonly usedIn: readonly string[];
  readonly match: { readonly kind: "exact" | "similar"; readonly exerciseId: string } | null;
  readonly pickedId: string | null;
  readonly selected: "match" | "picked" | "new";
  readonly newValue: ExerciseFieldValues;
  readonly detailsOpen: boolean;
}

/**
 * The names that get a card: only those of exercises the routine keeps. The section and item caps do not
 * depend on the chosen types, so any `modalityOf` gives the same survivors; this also caps the cards at 30.
 */
export function cardNames(read: ReadResult): ReadName[] {
  const kept = new Set(buildImportPlan(read, () => "weight_reps").items.map((item) => item.nameKey));
  return read.names.filter((name) => kept.has(name.key));
}

/** AC24: exact or similar → that exercise, pre-picked; nothing similar → New. */
export function initialCards(names: readonly ReadName[], visible: readonly Exercise[]): CardState[] {
  return names.map((name, index) => {
    const found = matchExerciseName(name.written, visible);
    const match = found.kind === "none" ? null : { kind: found.kind, exerciseId: found.row.id };
    return {
      key: name.key,
      index,
      written: name.written,
      usedIn: name.sections,
      match,
      pickedId: null,
      selected: match ? "match" : "new",
      newValue: { ...EMPTY_EXERCISE_FIELDS, name: name.written.trim(), modality: guessModality(name.written) },
      detailsOpen: false,
    };
  });
}

export type CardProblem =
  | { readonly kind: "name"; readonly message: string }
  /** The New name equals a visible exercise (normalized). */
  | { readonly kind: "exists"; readonly exercise: Exercise }
  /** Equals another card's New name (every such card). */
  | { readonly kind: "same-new" }
  /** CreateExerciseSchema refuses the rest. */
  | { readonly kind: "invalid" };

function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return NEW_NAME_REQUIRED;
  if (trimmed.length > 120) return NEW_NAME_TOO_LONG;
  return CatalogName.safeParse(trimmed).success ? null : NEW_NAME_INVALID;
}

/** AC27–AC28: only New cards, only those with a problem. Recomputed on the current `visible` rows. */
export function cardProblems(cards: readonly CardState[], visible: readonly Exercise[]): ReadonlyMap<string, CardProblem> {
  const problems = new Map<string, CardProblem>();
  const fresh = cards.filter((card) => card.selected === "new");
  if (fresh.length === 0) return problems;
  const byKey = new Map<string, Exercise>();
  for (const row of visible) {
    const key = normalizeExerciseName(row.name);
    if (key !== "" && !byKey.has(key)) byKey.set(key, row);
  }
  const newKeys = fresh.map((card) => normalizeExerciseName(card.newValue.name));
  fresh.forEach((card, i) => {
    const message = nameProblem(card.newValue.name);
    if (message !== null) return void problems.set(card.key, { kind: "name", message });
    const key = newKeys[i]!;
    const existing = key === "" ? undefined : byKey.get(key);
    if (existing) return void problems.set(card.key, { kind: "exists", exercise: existing });
    if (key !== "" && newKeys.some((other, j) => j !== i && other === key)) return void problems.set(card.key, { kind: "same-new" });
    if (!CreateExerciseSchema.safeParse(toCreateExerciseInput(card.newValue)).success) problems.set(card.key, { kind: "invalid" });
  });
  return problems;
}

/** AC27 "Use it instead": the card takes that exercise as its exact match. */
export function chooseExisting(card: CardState, exercise: Exercise): CardState {
  return { ...card, match: { kind: "exact", exerciseId: exercise.id }, selected: "match" };
}
