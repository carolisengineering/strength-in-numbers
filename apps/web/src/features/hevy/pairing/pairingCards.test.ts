import type { HevyTemplate, HevyType } from "@sin/core";
import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { NEW_NAME_REQUIRED } from "../../catalog/newExerciseName";
import { chooseExisting, chooseNew, chooseSkip, decisionsOf, initialPairingCards, problemFor, setNewValue, setRule, validity } from "./pairingCards";

const tpl = (id: string, title: string, type: HevyType | null = "weight_reps"): HevyTemplate =>
  ({ id, title, type, is_custom: true, primary_muscle_group: "chest", secondary_muscle_groups: [], equipment: "barbell" }) as HevyTemplate;
const need = (t: HevyTemplate) => ({ template: t });

const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });
const ROW = makeExercise({ id: exerciseId(2), name: "Row Erg", modality: "calories" });
const DIP = makeExercise({ id: exerciseId(3), name: "Dip", modality: "bodyweight_reps" });
const PLANK = makeExercise({ id: exerciseId(4), name: "Plank", modality: "duration" });
const VISIBLE = [BENCH, ROW, DIP, PLANK];

describe("20.0 AC26, AC27 — pairing cards model and validity", () => {
  it("an exact match is pre-selected; a trailing parenthetical is a similar match; nothing is New with the 19.1 prefill", () => {
    const cards = initialPairingCards(
      [need(tpl("A", "bench press")), need(tpl("B", "Bench Press (Barbell)")), need(tpl("C", "Zercher Squat"))],
      VISIBLE,
    );
    expect(cards.map((c) => [c.selected, c.match?.kind ?? null, c.match?.exerciseId ?? null])).toEqual([
      ["match", "exact", BENCH.id],
      ["match", "similar", BENCH.id],
      ["new", null, null],
    ]);
    expect(cards[2]!.newValue).toMatchObject({ name: "Zercher Squat", modality: "weight_reps" });
  });

  it("Echo Bike (calories) as New is Calories with the rule ticked; unticked it needs the rule", () => {
    const [card] = initialPairingCards([need(tpl("E", "Echo Bike (calories)", "reps_only"))], []);
    expect(card).toMatchObject({ selected: "new", rule: "calories_as_reps", ruleSuggested: "calories_as_reps" });
    expect(card!.newValue.modality).toBe("calories");
    expect(problemFor(card!, [])).toBeNull();
    expect(problemFor(setRule(card!, null), [])).toEqual({ kind: "rule_needed", rule: "calories_as_reps" });
  });

  it("an existing Calories exercise without the rule needs it; an assisted template on Bodyweight reps needs its rule", () => {
    const [row] = initialPairingCards([need(tpl("E", "Row Erg", "reps_only"))], VISIBLE);
    expect(row!.selected).toBe("match");
    expect(problemFor(setRule(row!, null), VISIBLE)).toEqual({ kind: "rule_needed", rule: "calories_as_reps" });
    const [dip] = initialPairingCards([need(tpl("D", "Dip", "bodyweight_assisted_reps"))], VISIBLE);
    expect(problemFor(setRule(dip!, null), VISIBLE)).toEqual({ kind: "rule_needed", rule: "assist_weight_ignored" });
    expect(problemFor(setRule(dip!, "assist_weight_ignored"), VISIBLE)).toBeNull();
  });

  it("weight_reps picked to a Duration exercise is a type problem with both labels", () => {
    const [card] = initialPairingCards([need(tpl("A", "Bench Press"))], VISIBLE);
    expect(problemFor(chooseExisting(card!, PLANK), VISIBLE)).toEqual({ kind: "type", hevyLabel: "Weight & reps", modalityLabel: "Duration" });
  });

  it("New cards: a blank name, and the same name twice", () => {
    const [a, b] = initialPairingCards([need(tpl("A", "Row")), need(tpl("B", "row"))], []);
    expect(problemFor(setNewValue(a!, { ...a!.newValue, name: "  " }), [])).toEqual({ kind: "name", message: NEW_NAME_REQUIRED });
    const v = validity([a!, b!], []);
    expect(v.valid).toBe(false);
    expect([...v.problems.values()]).toEqual([{ kind: "same-new" }, { kind: "same-new" }]);
  });

  it("Skip needs nothing; a picked exercise that left the list is gone", () => {
    const [card] = initialPairingCards([need(tpl("A", "Bench Press"))], VISIBLE);
    expect(problemFor(chooseSkip(card!), [])).toBeNull();
    expect(problemFor(chooseExisting(card!, BENCH), [ROW])).toEqual({ kind: "gone" });
  });

  it("a template whose type SIN does not support starts as Skip and can only skip", () => {
    const [card] = initialPairingCards([need(tpl("X", "Odd Machine", null))], VISIBLE);
    expect(card!.selected).toBe("skip");
    expect(problemFor(chooseNew(card!), VISIBLE)).toEqual({ kind: "unsupported" });
  });

  it("decisionsOf gives one decision per card, in order", () => {
    const needs = [need(tpl("A", "Bench Press")), need(tpl("E", "Echo Bike (calories)", "reps_only")), need(tpl("S", "Stretching", "duration"))];
    const [a, e, s] = initialPairingCards(needs, VISIBLE);
    const decisions = decisionsOf([a!, e!, chooseSkip(s!)], needs);
    expect(decisions.map((d) => [d.template.id, d.action])).toEqual([["A", "pair"], ["E", "create"], ["S", "skip"]]);
    expect(decisions[0]).toMatchObject({ exerciseId: BENCH.id, rule: null });
    expect(decisions[1]).toMatchObject({ rule: "calories_as_reps", create: { name: "Echo Bike (calories)", modality: "calories" } });
  });
});
