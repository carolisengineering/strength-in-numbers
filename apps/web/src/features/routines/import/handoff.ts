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

export function buildHandoff(args: {
  read: ReadResult;
  cards: readonly CardState[];
  /** The catalog store's raw rows (a chosen row may have left `visible` since). */
  rows: readonly Exercise[];
  placeholderFor: (cardKey: string) => string;
}): ImportHandoff {
  const { read, cards, rows, placeholderFor } = args;
  const rowById = new Map<string, Exercise>(rows.map((row) => [row.id, row]));
  const writtenOf = new Map(read.names.map((name) => [name.key, name.written]));
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
    modality.set(card.key, rowById.get(id)?.modality ?? guessModality(card.written));
  }

  const modalityOf = (key: string): Modality => modality.get(key) ?? guessModality(writtenOf.get(key) ?? "");
  return { plan: buildImportPlan(read, modalityOf), exerciseIdOf, pending };
}
