import { describe, expect, it } from "vitest";
import type { Modality } from "../src/enums.js";
import { RoutineWriteSchema } from "../src/dto/routine.js";
import { buildImportPlan, cutName, cutNote, type ImportPlan } from "../src/importPlan.js";
import { readWorkoutText } from "../src/workoutText.js";
import { toWrite } from "./helpers/importPlan.js";

const plan = (lines: string[], m: (k: string) => Modality = () => "weight_reps") => buildImportPlan(readWorkoutText(lines.join("\n")), m);

describe("10.4 AC17 — reps follow the exercise type", () => {
  it.each(["duration", "distance_duration"] as const)("%s keeps the rows, drops reps, notes the scheme", (m) => {
    const p = plan(["Engine", "21-15-9", "Row", "Ski", "x."], () => m);
    expect(p.items[0]).toMatchObject({ form: { kind: "quick", targetSets: 3, targetRepsLow: null, targetRepsHigh: null }, notes: "21-15-9 reps as written" });
  });
  it("a/b on a rep-less type", () => expect(plan(["A", "3 Sets:", "10/10 Hold Thing", "x."], () => "duration").items[0]!.notes).toBe("10/10 reps as written"));
  it("a rep outside 1–100 drops the item's reps into the note", () =>
    expect(plan(["Engine", "150-100-50", "Row", "Ski", "x."]).items[0]).toMatchObject({ form: { kind: "quick", targetSets: 3, targetRepsLow: null, targetRepsHigh: null }, notes: "150-100-50 reps as written" }));
  it("weights, RPE and rest are never set", () => {
    const p = plan(["Strength", "3 Sets:", "10 Curl", "x."]);
    expect(Object.keys(p.items[0]!.form).sort()).toEqual(["kind", "targetRepsHigh", "targetRepsLow", "targetSets"]);
  });
});

describe("10.4 AC17 — quick vs plan, order and groups", () => {
  it("uniform rows → quick; varied → plan; rowless → quick without sets", () => {
    const p = plan(["- 8 Goblet Squat", "Strength", "3 Sets:", "10 Curl", "10 Row", "Set 1: 5 Reps", "Set 2: 3 Reps", "x."]);
    expect(p.items.map((i) => [i.name, i.section, i.form])).toEqual([
      ["Goblet Squat", null, { kind: "quick", targetSets: null, targetRepsLow: 8, targetRepsHigh: 8 }],
      ["Curl", 0, { kind: "quick", targetSets: 3, targetRepsLow: 10, targetRepsHigh: 10 }],
      ["Row", 0, { kind: "quick", targetSets: 3, targetRepsLow: 10, targetRepsHigh: 10 }],
      ["Strength", 0, { kind: "plan", rows: [{ repsLow: 5, repsHigh: 5 }, { repsLow: 3, repsHigh: 3 }] }],
    ]);
    expect(p.items.map((i) => i.supersetGroup)).toEqual([null, 1, 1, null]);
  });
  it("groups number by first appearance; a run of one is ungrouped", () =>
    expect(plan(["A", "21-15-9", "P", "Q", "Into:", "21-15-9", "R", "Accessory", "3 Sets:", "S", "T", "x."]).items.map((i) => i.supersetGroup)).toEqual([1, 1, null, 2, 2]));
});

describe("10.4 AC17 — limits are cut and reported (§6.6)", () => {
  const many = (n: number, f: (k: number) => string) => Array.from({ length: n }, (_, k) => f(k));
  it.each([
    ["name-cut section-name-cut", [`Workout: "${"N".repeat(81)}"`, "x."], (p: ImportPlan) => expect([p.name.length, p.sections[0]!.name.length]).toEqual([80, 40])],
    ["section-name-cut", [`Workout: "${"S".repeat(41)}"`, "x."], (p: ImportPlan) => expect(p.sections[0]!.name).toHaveLength(40)],
    ["section-note-cut", ["Strength", ...many(30, () => "w".repeat(99) + ".")], (p: ImportPlan) => { expect(p.sections[0]!.notes!.length).toBeLessThanOrEqual(2000); expect(p.sections[0]!.notes!.endsWith("…")).toBe(true); }],
    ["routine-note-cut", [...many(30, () => "w".repeat(99) + "."), "Strength", "x."], (p: ImportPlan) => expect(p.notes!.endsWith("…")).toBe(true)],
    ["item-note-cut", ["Strength", ...many(20, (k) => `Set ${k + 1}: 5 Reps @ ${"t".repeat(40)}`), "x."], (p: ImportPlan) => expect(p.items[0]!.notes!.length).toBeLessThanOrEqual(500)],
    ["sections-left-out", many(10, (k) => `Block ${String.fromCharCode(65 + k)}x\n- 5 Curl ${k}x`).concat("x."), (p: ImportPlan) => expect(p.sections).toHaveLength(8)],
    ["items-left-out", ["Strength", ...many(31, (k) => `- 5 Curl ${k}x`), "x."], (p: ImportPlan) => expect(p.items).toHaveLength(30)],
    ["sets-cut", ["Strength", ...many(21, (k) => `Set ${k + 1}: 5 Reps`), "x."], (p: ImportPlan) => expect(p.items[0]!.form).toMatchObject({ kind: "quick", targetSets: 20 })],
    ["superset-split", ["Circuit", "2 Rounds", ...many(9, (k) => `Move ${String.fromCharCode(65 + k)}x`), "x."], (p: ImportPlan) => expect(p.items.map((i) => i.supersetGroup)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, null])],
  ])("%s", (codes, lines, check) => {
    const p = plan(lines as string[]);
    expect(p.notices.map((n) => n.code)).toEqual((codes as string).split(" "));
    (check as (p: ImportPlan) => void)(p);
    expect(RoutineWriteSchema.safeParse(toWrite(p)).success).toBe(true);
  });
  it("sections-left-out names the headings; its exercises go too", () =>
    expect(plan(many(10, (k) => `Block ${String.fromCharCode(65 + k)}x\n- 5 Curl ${k}x`).concat("x.")).notices[0]).toEqual({ code: "sections-left-out", count: 2, names: ["Block Ix", "Block Jx"] }));
  it("sets-cut names each exercise once, as written", () =>
    expect(plan(["Strength", ...many(21, (k) => `Set ${k + 1}: 5 Reps`), "x."]).notices).toEqual([{ code: "sets-cut", names: ["Strength"] }]));
  it("a run cut by the 30-item cap leaves no group of one", () => {
    const p = plan(["Strength", ...many(29, (k) => `- 5 Curl ${k}x`), "3 Sets:", "Row", "Ski", "x."]);
    expect(p.items.at(-1)).toMatchObject({ name: "Row", supersetGroup: null });
    expect(RoutineWriteSchema.safeParse(toWrite(p)).success).toBe(true);
  });
  it("cuts land on code-point boundaries", () => {
    expect(cutNote("a".repeat(498) + "😀😀", 500)).toBe("a".repeat(498) + "…");
    expect(cutName("é".repeat(39) + "😀", 40)).toBe("é".repeat(39));
    expect(cutNote("short", 500)).toBe("short");
  });
  it("deferred minor 17: a cut note drops trailing whitespace before the '…' and never splits a joined emoji", () => {
    expect(cutNote("a".repeat(498) + "\nbbbb", 500)).toBe("a".repeat(498) + "…");
    expect(cutNote("a".repeat(496) + "👨‍👩‍👧 end", 500)).toBe("a".repeat(496) + "…");
    expect(cutNote("a".repeat(490) + "👍🏽👍🏽👍🏽", 500)).toBe("a".repeat(490) + "👍🏽👍🏽" + "…");
    expect(cutName("b".repeat(38) + "👨‍👩‍👧", 40)).toBe("b".repeat(38));
  });
  it("a 2,000-character note ending in emoji and a 41-character accented name stay schema-valid", () => {
    const p = plan([`Workout: "${"É".repeat(40)}😀"`, "😀".repeat(1_100), "x."]);
    expect(p.sections[0]!.name).toBe("É".repeat(40));
    expect(RoutineWriteSchema.safeParse(toWrite(p)).success).toBe(true);
  });
  it.each(['Workout: " "', 'Workout: "   "', "Workout: “ ”"])("a title of only spaces (%s) never names the routine or a section", (title) => {
    const p = plan([title, "Strength", "x."]);
    expect(p.name).toBe("Strength");
    expect(RoutineWriteSchema.safeParse(toWrite(p)).success).toBe(true);
  });
  it("nothing is cut without a notice", () => expect(plan(["Strength", "3 Sets:", "10 Curl", "x."]).notices).toEqual([]));
});
