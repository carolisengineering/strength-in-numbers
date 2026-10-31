import { normalizeExerciseName, readWorkoutText } from "@sin/core";
import { describe, expect, it } from "vitest";

import { exerciseId } from "../../../test/catalogFixtures";
import { HIRAYA_TEXT, importCatalog } from "../../../test/importFixtures";
import { cardNames, cardProblems, initialCards } from "./cards";
import { buildHandoff, emptyHandoff, indexRowsById } from "./handoff";
import { NEW_NAME_TOO_LONG } from "./messages";

const read = readWorkoutText(HIRAYA_TEXT);
const cards = initialCards(cardNames(read), importCatalog);

describe("10.4 AC28 — Continue's hand-off", () => {
  const ph = (k: string) => `ph-${k}`; // the test's placeholderFor; real ones are UUIDs
  it("ids per choice, pending per New card, plan built with the chosen types", () => {
    const h = buildHandoff({ read, cards, rowById: indexRowsById(importCatalog), placeholderFor: ph });
    expect(h.exerciseIdOf.get(normalizeExerciseName("Power Clean"))).toBe(exerciseId(15));
    expect(h.exerciseIdOf.get(normalizeExerciseName("Hand Release Pushups"))).toBe(ph(normalizeExerciseName("Hand Release Pushups")));
    expect([...h.pending.keys()]).toEqual(["Hand Release Pushups", "Front Raise", "Reverse Fly"].map((w) => ph(normalizeExerciseName(w))));
    expect(h.pending.get(ph(normalizeExerciseName("Front Raise")))!.input).toEqual({ name: "Front Raise", modality: "weight_reps", primaryMuscleId: null, secondaryMuscleIds: [], equipmentId: null });
    expect(h.plan.items).toHaveLength(8);
    expect(h.plan.items[4]).toMatchObject({ name: "400 Meter Run", form: { kind: "quick", targetRepsLow: null } });
  });
  it("a Type change on a New card is reflected (Review Focus 4)", () => {
    const changed = cards.map((c) => (c.written === "Hand Release Pushups" ? { ...c, newValue: { ...c.newValue, modality: "duration" as const } } : c));
    const item = buildHandoff({ read, cards: changed, rowById: indexRowsById(importCatalog), placeholderFor: ph }).plan.items[2]!;
    expect(item).toMatchObject({ form: { kind: "quick", targetSets: 3, targetRepsLow: null, targetRepsHigh: null }, notes: "21-15-9 reps as written" });
  });
  it("a picked exercise's type decides the reps; a row gone from the store falls back to the guess", () => {
    const picked = cards.map((c) => (c.written === "Front Raise" ? { ...c, selected: "picked" as const, pickedId: exerciseId(9) } : c));
    expect(buildHandoff({ read, cards: picked, rowById: indexRowsById(importCatalog), placeholderFor: ph }).plan.items[5]).toMatchObject({ form: { targetRepsLow: null } });
    const gone = cards.map((c) => (c.written === "Front Raise" ? { ...c, selected: "picked" as const, pickedId: exerciseId(77) } : c));
    expect(buildHandoff({ read, cards: gone, rowById: indexRowsById(importCatalog), placeholderFor: ph }).plan.items[5]).toMatchObject({ form: { targetRepsLow: 10 } });
  });
  it("a long strength-block name is a card problem, not a Save failure (Review Focus 5)", () => {
    const r = readWorkoutText(`Workout: "${"Long ".repeat(30)}"\nSet 1: 5 Reps\nx.`);
    const [card] = initialCards(cardNames(r), importCatalog);
    expect(cardProblems([card!], importCatalog).get(card!.key)).toEqual({ kind: "name", message: NEW_NAME_TOO_LONG });
  });
  it("emptyHandoff: the plan with no ids and nothing to create", () => {
    const r = readWorkoutText("Warmup\nWalk.\nCooldown\nStretch.");
    const h = emptyHandoff(r);
    expect([h.plan.sections.map((s) => s.name), h.exerciseIdOf.size, h.pending.size]).toEqual([["Warmup", "Cooldown"], 0, 0]);
  });
});
