import { readWorkoutText } from "@sin/core";
import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { HIRAYA_TEXT, importCatalog } from "../../../test/importFixtures";
import { cardNames, cardProblems, initialCards, chooseExisting, keptSectionCount, type CardState } from "./cards";
import { NEW_NAME_INVALID, NEW_NAME_REQUIRED, NEW_NAME_TOO_LONG } from "./messages";

const read = readWorkoutText(HIRAYA_TEXT);
const cards = initialCards(cardNames(read), importCatalog);
const nameOf = (id: string | undefined) => (id === undefined ? null : (importCatalog.find((e) => e.id === id)?.name ?? null));

describe("10.4 AC24 — one card per name, pre-decided", () => {
  it("states against the fixture catalog, in first-appearance order", () =>
    expect(cards.map((c) => [c.written, c.selected, c.match?.kind ?? null, nameOf(c.match?.exerciseId), c.usedIn])).toEqual([
      ["Strict Press", "match", "similar", "Overhead press", ["Strict Press"]],
      ["Power Clean", "match", "exact", "Power Clean", ["Second Shift"]],
      ["Hand Release Pushups", "new", null, null, ["Second Shift"]],
      ["Push Press", "match", "similar", "Overhead press", ["Second Shift"]],
      ["400 Meter Run", "match", "similar", "Treadmill run", ["Second Shift"]],
      ["Front Raise", "new", null, null, ["Accessory"]],
      ["Reverse Fly", "new", null, null, ["Accessory"]],
      ["DB Lateral Lunge", "match", "similar", "Dumbbell lunge", ["Accessory"]],
    ]));
  it("indexes follow the order", () => expect(cards.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]));
  it("New starts from the written name and the guessed type", () =>
    expect(cards[2]!.newValue).toEqual({ name: "Hand Release Pushups", modality: "bodyweight_reps", primaryMuscleId: "", secondaryMuscleIds: [], equipmentId: "" }));
  it("names only of exercises the routine keeps: a 9th section and items past 30 get no card", () => {
    const blocks = Array.from({ length: 9 }, (_, k) => `Block ${String.fromCharCode(65 + k)}x\n- 5 Lift ${String.fromCharCode(65 + k)}`);
    const nine = readWorkoutText([...blocks, "x."].join("\n"));
    expect(cardNames(nine).map((n) => n.written)).not.toContain("Lift I");
    const many = readWorkoutText(["Strength", ...Array.from({ length: 31 }, (_, k) => `- 5 Lift ${k}x`), "x."].join("\n"));
    expect(cardNames(many)).toHaveLength(30);
  });
  it("deferred minor 23: the summary's section count is the sections the routine keeps (8 of 9), like its exercise count", () => {
    const blocks = Array.from({ length: 9 }, (_, k) => `Block ${String.fromCharCode(65 + k)}x\n- 5 Lift ${String.fromCharCode(65 + k)}`);
    const nine = readWorkoutText([...blocks, "x."].join("\n"));
    expect(nine.sections).toHaveLength(9);
    expect(keptSectionCount(nine)).toBe(8);
    expect(keptSectionCount(read)).toBe(read.sections.length);
  });
});

describe("10.4 AC27 — names that already exist", () => {
  const asNew = (c: CardState, name: string): CardState => ({ ...c, selected: "new", newValue: { ...c.newValue, name } });
  it("matches a visible exercise ignoring case, punctuation, hyphens and plurals", () =>
    expect(cardProblems([asNew(cards[2]!, "overhead-presses")], importCatalog).get(cards[2]!.key)).toMatchObject({ kind: "exists", exercise: { name: "Overhead press" } }));
  it("two New cards with one name: both blocked", () => {
    const p = cardProblems([asNew(cards[5]!, "Raise Front"), asNew(cards[6]!, "raise-fronts")], importCatalog);
    expect([p.get(cards[5]!.key), p.get(cards[6]!.key)]).toEqual([{ kind: "same-new" }, { kind: "same-new" }]);
  });
  it.each([["", NEW_NAME_REQUIRED], ["   ", NEW_NAME_REQUIRED], ["x".repeat(121), NEW_NAME_TOO_LONG], ["Bad\u0007Name", NEW_NAME_INVALID]])("%j → %s", (name, message) =>
    expect(cardProblems([asNew(cards[2]!, name)], importCatalog).get(cards[2]!.key)).toEqual({ kind: "name", message }));
  it("a New card with no type is invalid", () =>
    expect(cardProblems([{ ...cards[2]!, newValue: { ...cards[2]!.newValue, modality: null } }], importCatalog).get(cards[2]!.key)).toEqual({ kind: "invalid" }));
  it("only New cards are checked", () => expect(cardProblems(cards, importCatalog).size).toBe(0));
  it("the catalog gaining the name later flags it (Review Focus 2)", () => {
    const later = [...importCatalog, makeExercise({ id: exerciseId(99), name: "Hand-release push-up" })];
    expect(cardProblems([cards[2]!], later).get(cards[2]!.key)).toMatchObject({ kind: "exists" });
  });
  it("a matched or picked exercise that has left the list blocks the card", () => {
    const without = importCatalog.filter((e) => e.name !== "Power Clean");
    expect(cardProblems(cards, without).get(cards[1]!.key)).toEqual({ kind: "gone" });
    const picked = { ...cards[5]!, selected: "picked" as const, pickedId: exerciseId(77) };
    expect(cardProblems([picked], importCatalog).get(picked.key)).toEqual({ kind: "gone" });
  });
  it("chooseExisting selects that exercise as exact", () =>
    expect(chooseExisting(cards[2]!, importCatalog[0]!)).toMatchObject({ selected: "match", match: { kind: "exact", exerciseId: importCatalog[0]!.id } }));
});
