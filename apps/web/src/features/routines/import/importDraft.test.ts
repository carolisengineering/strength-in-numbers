import { ExerciseIdSchema, readWorkoutText } from "@sin/core";
import { describe, expect, it } from "vitest";

import { exerciseId } from "../../../test/catalogFixtures";
import { HIRAYA_TEXT, importCatalog, randomPlan } from "../../../test/importFixtures";
import { actions, reduce } from "../routineDraft";
import { cardNames, initialCards } from "./cards";
import { buildHandoff } from "./handoff";
import { draftFromImport } from "./importDraft";

const read = readWorkoutText(HIRAYA_TEXT);
const placeholders = new Map<string, string>();
const placeholderFor = (k: string) => placeholders.get(k) ?? (placeholders.set(k, crypto.randomUUID()), placeholders.get(k)!);
const handoff = buildHandoff({ read, cards: initialCards(cardNames(read), importCatalog), rows: importCatalog, placeholderFor });
const idOf = (k: string) => handoff.exerciseIdOf.get(k)!;

describe("10.4 AC29 — the draft from an import", () => {
  it("shape: sections, items, forms, notes, groups; dirty; never weights", () => {
    const d = draftFromImport(handoff.plan, idOf);
    expect(d).toMatchObject({ name: "Second Shift", notes: "", dirty: true, adjusted: false, unlinkNotice: false });
    expect(d.sections.map((s) => s.name)).toEqual(["Warmup", "Strict Press", "Second Shift", "Accessory"]);
    expect(d.sections[0]!.notes.split("\n")).toHaveLength(15);
    expect(d.sections[3]!.notes).toBe("");
    expect(d.items.map((i) => [i.supersetGroup, i.plan?.map((r) => r.repsLow) ?? null, i.targetSets, i.targetRepsLow, i.targetRepsHigh])).toEqual([
      [null, [6, 6, 4, 4, 10, 10], 6, 4, 10],
      [1, [21, 15, 9], 3, 9, 21],
      [1, [21, 15, 9], 3, 9, 21],
      [2, [21, 15, 9], 3, 9, 21],
      [2, null, 3, null, null],
      [3, null, 3, 10, 10],
      [3, null, 3, 10, 15],
      [3, null, 3, 20, 20],
    ]);
    expect(d.items.every((i) => i.weight === null && i.weightUnit === null && i.targetRpe === null && i.restSeconds === null)).toBe(true);
    expect(d.items.every((i) => (i.plan ?? []).every((r) => r.setType === "working" && r.weight === null && r.weightUnit === null))).toBe(true);
    expect(d.items[0]!.sectionKey).toBe(d.sections[1]!.key);
    expect(d.items[0]!.notes).toBe("Set 1 @ 45–50%\nSet 2 @ 55–60%\nSet 3 @ 60–65%\nSet 4 @ 65–70%\nSet 5 @ 70–75%\nSet 6 @ Build If Able");
    expect(d.items[1]!.notes).toBeNull();
    expect(d.items.map((i) => i.exerciseId)).toEqual(handoff.plan.items.map((i) => idOf(i.nameKey)));
  });

  it("keys are unique; a placeholder per New card is a valid exercise id, shared by every item with that name", () => {
    const d = draftFromImport(handoff.plan, idOf);
    const keys = [...d.sections.map((s) => s.key), ...d.items.map((i) => i.key), ...d.items.flatMap((i) => i.plan?.map((r) => r.key) ?? [])];
    expect(new Set(keys).size).toBe(keys.length);
    for (const ph of handoff.pending.keys()) expect(ExerciseIdSchema.safeParse(ph).success).toBe(true);
    const twice = readWorkoutText("Strength\n3 Sets:\n10 Zercher Curl\n10 Row\nAccessory\n2 Sets:\n8 Zercher Curls\nx.");
    const h2 = buildHandoff({ read: twice, cards: initialCards(cardNames(twice), []), rows: [], placeholderFor });
    const d2 = draftFromImport(h2.plan, (k) => h2.exerciseIdOf.get(k)!);
    expect(d2.items[0]!.exerciseId).toBe(d2.items[2]!.exerciseId);
  });

  it.each(Array.from({ length: 100 }, (_, i) => i + 1))("settle leaves it unchanged (seed %i)", (seed) => {
    const d = draftFromImport(randomPlan(seed), () => exerciseId(1));
    if (d.sections.length >= 8) return;
    const added = reduce(d, actions.addSection("Probe"));
    const back = reduce(added, actions.deleteSection(added.sections.at(-1)!.key));
    expect(back.items).toEqual(d.items); // deleteSection runs settle over every item
  });
});
