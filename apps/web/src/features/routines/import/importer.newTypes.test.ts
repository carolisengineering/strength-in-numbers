import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readWorkoutText } from "@sin/core";
import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { importCatalog } from "../../../test/importFixtures";
import { cardNames, initialCards } from "./cards";
import { buildHandoff } from "./handoff";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../../../packages/core/test/fixtures");
const ph = (k: string) => `ph-${k}`;
const cardsFor = (text: string, catalog = importCatalog) => {
  const read = readWorkoutText(text);
  return { read, cards: initialCards(cardNames(read), catalog) };
};
const view = (cards: ReturnType<typeof initialCards>) => cards.map((c) => ({ written: c.written, selected: c.selected, match: c.match, modality: c.newValue.modality }));

describe("18.1 AC34 — importer hint", () => {
  it("Max Cal Echo Bike gives a New card Echo Bike with Calories pre-selected", () => {
    const { cards } = cardsFor(["Engine", "3 Rounds:", "Max Cal Echo Bike with remaining time", "x."].join("\n"), []);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ written: "Echo Bike", selected: "new", newValue: { modality: "calories" } });
  });
  it("20 Cal Row gives New Row with Calories; the item has no reps and keeps the 20 Cal note; saving creates a calories exercise", () => {
    const { read, cards } = cardsFor(["Engine", "3 Sets:", "20 Cal Row", "x."].join("\n"), []);
    expect(cards[0]).toMatchObject({ written: "Row", selected: "new", newValue: { modality: "calories" } });
    const h = buildHandoff({ read, cards: cards.map((c) => ({ ...c, newValue: { ...c.newValue, name: "Row" } })), rows: [], placeholderFor: ph });
    expect(h.plan.items[0]).toMatchObject({ form: { targetRepsLow: null, targetRepsHigh: null } });
    expect(h.plan.items[0]!.notes).toContain("20 Cal");
    expect([...h.pending.values()][0]!.input).toMatchObject({ name: "Row", modality: "calories" });
  });
  it("a name that matches an existing exercise keeps that exercise and its type", () => {
    const bike = makeExercise({ id: exerciseId(42), name: "Echo Bike", modality: "duration", equipmentId: null });
    const { read, cards } = cardsFor(["Engine", "3 Rounds:", "Max Cal Echo Bike", "x."].join("\n"), [bike]);
    expect(cards[0]).toMatchObject({ selected: "match", match: { exerciseId: bike.id } });
    const h = buildHandoff({ read, cards, rows: [bike], placeholderFor: ph });
    expect(h.exerciseIdOf.get(cards[0]!.key)).toBe(bike.id);
    expect(h.pending.size).toBe(0);
  });
  // "the handoff's fallback guess for an unmatched, unsaved name uses the hint too" lives in handoff.hint.test.ts: since
  // minor 90 a hinted name has only calorie lines, which carry no reps, so the guess is visible only through a spy.
  it("Minor 90 (owner ruling O1) — a name read with and without a calorie form gets no hint, so 10 Row keeps its reps", () => {
    const { read, cards } = cardsFor(["Engine", "3 Sets:", "10 Row", "Max Cal Row", "x."].join("\n"), []);
    expect(cards[0]!.newValue.modality).toBe("weight_reps");
    const h = buildHandoff({ read, cards: cards.map((c) => ({ ...c, selected: "match" as const, match: null })), rows: [], placeholderFor: ph });
    expect(h.plan.items[0]!.notes ?? "").not.toContain("reps as written");
  });
  it("Minor 90 (owner ruling O1) — Max Cal in one section and plain Echo Bike in another make one card with no Calories guess", () => {
    const { cards } = cardsFor(["Engine", "3 Rounds:", "Max Cal Echo Bike", "Finisher", "2 Sets:", "Echo Bike", "x."].join("\n"), []);
    expect(cards.filter((c) => c.written === "Echo Bike")).toHaveLength(1);
    expect(cards.find((c) => c.written === "Echo Bike")!.newValue.modality).toBe("distance_duration");
  });
});

/** The cards each fixture gave on main (2e1c249), before the hint reached the importer. */
const BASELINE_10_19 = [
  ["Strict Press", "match", "weight_reps"],
  ["Power Clean", "match", "weight_reps"],
  ["Hand Release Pushups", "new", "bodyweight_reps"],
  ["Push Press", "match", "weight_reps"],
  ["400 Meter Run", "match", "distance_duration"],
  ["Front Raise", "new", "weight_reps"],
  ["Reverse Fly", "new", "weight_reps"],
  ["DB Lateral Lunge", "match", "weight_reps"],
];
const BASELINE_10_24 = [
  ["200 Meter Run", "match", "distance_duration"],
  ["Echo Bike", "new", "distance_duration"],
  ["Double DB Bench Press", "match", "weight_reps"],
  ["DB or Plate Front Raises", "new", "weight_reps"],
  ["Tuckups", "new", "weight_reps"],
  ["Hollow Rocks", "new", "weight_reps"],
];

describe("18.1 AC34 — fixtures", () => {
  it("hiraya-2026-10-19 gives exactly the cards it gave before", () => {
    const { cards } = cardsFor(readFileSync(join(FIXTURES, "hiraya-2026-10-19.txt"), "utf8"));
    expect(view(cards).map((c) => [c.written, c.selected, c.modality])).toEqual(BASELINE_10_19);
  });
  it("hiraya-2026-10-24 differs only by Echo Bike's pre-selected Calories", () => {
    const { cards } = cardsFor(readFileSync(join(FIXTURES, "hiraya-2026-10-24.txt"), "utf8"));
    const expected = BASELINE_10_24.map(([w, sel, m]) => [w, sel, w === "Echo Bike" ? "calories" : m]);
    expect(view(cards).map((c) => [c.written, c.selected, c.modality])).toEqual(expected);
  });
});
