import {
  CreateExerciseSchema,
  buildImportPlan,
  guessModality,
  type CreateExercise,
  type Exercise,
  type ImportPlan,
  type Modality,
  type ReadResult,
} from "@sin/core";

import { toCreateExerciseInput } from "../../catalog/ExerciseFields";
import type { CardState } from "./cards";

/** Spec 10.4 AC28 / §6.5: what Continue hands to the editor (Phase C). Pure. */
export interface PendingExercise {
  readonly cardKey: string;
  /** Parsed by CreateExerciseSchema. */
  readonly input: CreateExercise;
}

export interface ImportHandoff {
  readonly plan: ImportPlan;
  /** nameKey → a real exercise id, or a placeholder id for a New card. */
  readonly exerciseIdOf: ReadonlyMap<string, string>;
  /** Placeholder id → the exercise to create at Save. */
  readonly pending: ReadonlyMap<string, PendingExercise>;
}

/** AC22 "Open in the editor anyway": the sections and notes, no exercises. */
export function emptyHandoff(read: ReadResult): ImportHandoff {
  return { plan: buildImportPlan(read, () => "weight_reps"), exerciseIdOf: new Map(), pending: new Map() };
}

/** Minor 223: the catalog store's raw rows by id; the Check screen builds it once and shares it with `buildHandoff`. */
export function indexRowsById(rows: readonly Exercise[]): ReadonlyMap<string, Exercise> {
  return new Map<string, Exercise>(rows.map((row) => [row.id, row]));
}

export function buildHandoff(args: {
  read: ReadResult;
  cards: readonly CardState[];
  /** `indexRowsById` over the catalog store's raw rows (a chosen row may have left `visible` since). */
  rowById: ReadonlyMap<string, Exercise>;
  placeholderFor: (cardKey: string) => string;
}): ImportHandoff {
  const { read, cards, rowById, placeholderFor } = args;
  const writtenOf = new Map(read.names.map((name) => [name.key, name.written]));
  // Spec 18.1 AC34: the reader's calories hint (a "Max Cal …" or "20 Cal …" line) seeds both fallback guesses.
  const caloriesOf = new Map(read.names.map((name) => [name.key, name.calories]));
  const exerciseIdOf = new Map<string, string>();
  const pending = new Map<string, PendingExercise>();
  const modality = new Map<string, Modality>();

  for (const card of cards) {
    if (card.selected === "new") {
      const id = placeholderFor(card.key);
      exerciseIdOf.set(card.key, id);
      const input = CreateExerciseSchema.parse(toCreateExerciseInput(card.newValue));
      pending.set(id, { cardKey: card.key, input });
      modality.set(card.key, input.modality);
      continue;
    }
    const id = card.selected === "picked" ? card.pickedId : (card.match?.exerciseId ?? null);
    if (id === null) continue;
    exerciseIdOf.set(card.key, id);
    modality.set(card.key, rowById.get(id)?.modality ?? guessModality(card.written, { calories: caloriesOf.get(card.key) === true }));
  }

  const modalityOf = (key: string): Modality =>
    modality.get(key) ?? guessModality(writtenOf.get(key) ?? "", { calories: caloriesOf.get(key) === true });
  return { plan: buildImportPlan(read, modalityOf), exerciseIdOf, pending };
}
