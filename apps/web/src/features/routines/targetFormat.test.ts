import { describe, expect, it } from "vitest";
import { PlannedSetInputSchema, ROUTINE_ITEM_NOTES_MAX, RoutineItemInputSchema, SET_WEIGHT_MAX } from "@sin/core";
import {
  formatReps,
  formatRest,
  formatWeight,
  itemAccessibleName,
  parseNotes,
  parseReps,
  parseRest,
  parseSets,
  parseWeight,
  plannedWeightText,
  REST_MESSAGE,
  RPE_CHOICES,
  routineSummary,
  targetLine,
  WEIGHT_MESSAGE,
  type Targets,
} from "./targetFormat";

const none: Targets = { targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null };

describe("10.0 AC9 — rest parses as m:ss and formats back", () => {
  it.each([
    ["1:30", 90],
    ["0:00", 0],
    ["15:00", 900],
    ["2:05", 125],
    ["", null],
    ["  ", null],
  ])("parseRest(%j) → %j", (text, value) => {
    expect(parseRest(text)).toEqual({ ok: true, value });
  });

  it.each(["15:01", "1:75", "1:5", "abc", "-1:00", "90", "1:30:00"])("rejects %j", (text) => {
    expect(parseRest(text)).toEqual({ ok: false, message: REST_MESSAGE });
  });

  it("formats seconds as m:ss", () => {
    expect(formatRest(90)).toBe("1:30");
    expect(formatRest(0)).toBe("0:00");
    expect(formatRest(900)).toBe("15:00");
    expect(formatRest(65)).toBe("1:05");
  });
});

describe("10.0 AC9 — reps are one input: a number or a range", () => {
  it.each([
    ["8", 8, 8],
    ["8-10", 8, 10],
    ["8–10", 8, 10],
    ["8 - 10", 8, 10],
    [" 8 ", 8, 8],
    ["8–10 ", 8, 10],
  ])("parseReps(%j)", (text, low, high) => {
    expect(parseReps(text)).toEqual({ ok: true, value: { low, high } });
  });

  it("blank is no target", () => {
    expect(parseReps("")).toEqual({ ok: true, value: { low: null, high: null } });
  });

  it.each(["10-8", "0", "101", "8-", "-8", "8-10-12", "eight"])("rejects %j", (text) => {
    expect(parseReps(text).ok).toBe(false);
  });

  it("formats back to the input form", () => {
    expect(formatReps(8, 8)).toBe("8");
    expect(formatReps(8, 10)).toBe("8-10");
    expect(formatReps(null, null)).toBe("");
  });
});

describe("10.0 AC9 — sets, RPE and notes bounds come from the core schema", () => {
  it("sets accept exactly what the schema accepts for 0..21", () => {
    for (let n = 0; n <= 21; n += 1) {
      const schemaOk = RoutineItemInputSchema.shape.targetSets.safeParse(n).success;
      expect(parseSets(String(n)).ok, String(n)).toBe(schemaOk);
    }
    expect(parseSets("")).toEqual({ ok: true, value: null });
    expect(parseSets("2.5").ok).toBe(false);
    expect(parseSets("3")).toEqual({ ok: true, value: 3 });
  });

  it("RPE choices are 6 to 10 in halves", () => {
    expect(RPE_CHOICES).toEqual([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
  });

  it("notes: blank → null, trimmed, capped at the core constant", () => {
    expect(parseNotes("   ")).toEqual({ ok: true, value: null });
    expect(parseNotes("  pause at bottom ")).toEqual({ ok: true, value: "pause at bottom" });
    expect(parseNotes("x".repeat(ROUTINE_ITEM_NOTES_MAX)).ok).toBe(true);
    expect(parseNotes("x".repeat(ROUTINE_ITEM_NOTES_MAX + 1)).ok).toBe(false);
  });
});

describe("10.0 AC9 — targetLine renders only what is set", () => {
  it.each<[Partial<Targets>, string]>([
    [{}, ""],
    [{ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10 }, "3 × 8–10"],
    [{ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 8 }, "3 × 8"],
    [{ targetSets: 3 }, "3 sets"],
    [{ targetSets: 1 }, "1 set"],
    [{ targetRepsLow: 8, targetRepsHigh: 10 }, "8–10 reps"],
    [{ targetRpe: 8 }, "RPE 8"],
    [{ targetRpe: 8.5 }, "RPE 8.5"],
    [{ restSeconds: 120 }, "2:00"],
    [{ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetRpe: 8, restSeconds: 120 }, "3 × 8–10 · RPE 8 · 2:00"],
  ])("%j → %j", (partial, line) => {
    expect(targetLine({ ...none, ...partial })).toBe(line);
  });
});

describe("10.0 AC9 — routineSummary counts exercises and distinct supersets", () => {
  const items = (groups: (number | null)[]) => ({ items: groups.map((supersetGroup) => ({ supersetGroup })) });
  it.each<[(number | null)[], string]>([
    [[null], "1 exercise"],
    [[null, null], "2 exercises"],
    [[1, 1, null], "3 exercises · 1 superset"],
    [[1, 1, null, 2, 2, 2], "6 exercises · 2 supersets"],
  ])("%j → %j", (groups, text) => {
    expect(routineSummary(items(groups))).toBe(text);
  });
});

describe("10.0 AC9 — row accessible names carry group and targets", () => {
  it("joins only what is present", () => {
    expect(itemAccessibleName("Bench press", 1, "3 × 8–10", false)).toBe("Bench press, superset 1, 3 × 8–10");
    expect(itemAccessibleName("Bench press", null, "", false)).toBe("Bench press");
    expect(itemAccessibleName("Old row", null, "3 sets", true)).toBe("Old row, 3 sets, no longer available");
  });
});

describe("10.0 AC9 — notes count code points, as the server does", () => {
  it("300 emoji fit; 501 code points do not", () => {
    expect(parseNotes("💪".repeat(300)).ok).toBe(true);
    expect(parseNotes("💪".repeat(ROUTINE_ITEM_NOTES_MAX + 1)).ok).toBe(false);
  });
});

describe("10.2 AC1 — parseWeight / formatWeight", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["0", 0],
    ["62.5", 62.5],
    ["62,5", 62.5],
    [" 100 ", 100],
    ["0.001", 0.001],
    [String(SET_WEIGHT_MAX), SET_WEIGHT_MAX],
  ])("%j → %j", (text, value) => {
    expect(parseWeight(text)).toEqual({ ok: true, value });
  });

  it.each(["-1", "-0.5", "abc", "1.2.3", "1e3", "62.5kg", "1.2345", ".5", "5.", "10000", String(SET_WEIGHT_MAX + 0.001)])(
    "%j → the static message",
    (text) => {
      expect(parseWeight(text)).toEqual({ ok: false, message: WEIGHT_MESSAGE });
    },
  );

  it("never echoes the input", () => {
    expect(JSON.stringify(parseWeight("secret-abc"))).not.toContain("secret");
  });

  // The schema field is a plain number, so >3 decimals is an extra client rule (the column is numeric(7,3));
  // the parity table covers only values the schema itself decides.
  it("accepts and rejects exactly what the core weight field does, for every tested value", () => {
    const schema = PlannedSetInputSchema.shape.weight;
    for (const value of [0, 0.001, 62.5, 100, SET_WEIGHT_MAX, SET_WEIGHT_MAX + 0.001, 10_000, -0.001, -1]) {
      expect(parseWeight(String(value)).ok, String(value)).toBe(schema.safeParse(value).success);
    }
  });

  it("formatWeight prints no trailing zeros and no thousands separator", () => {
    expect(formatWeight(62.5)).toBe("62.5");
    expect(formatWeight(100)).toBe("100");
    expect(formatWeight(0.001)).toBe("0.001");
    expect(formatWeight(SET_WEIGHT_MAX)).toBe("9999.999");
  });
});

const kg = (weight: number | null) => ({ weight, weightUnit: weight === null ? null : ("kg" as const) });
const lb = (weight: number) => ({ weight, weightUnit: "lb" as const });

describe("10.2 AC2 — plannedWeightText", () => {
  it.each([
    ["no rows", [], ""],
    ["rows without a weight", [kg(null), kg(null)], ""],
    ["one weight", [kg(100)], "@ 100 kg"],
    ["the same weight and unit", [kg(100), kg(100), kg(100)], "@ 100 kg"],
    ["a ramp in one unit", [kg(60), kg(80), kg(100)], "@ 60–100 kg"],
    ["a ramp listed high to low", [kg(100), kg(60)], "@ 60–100 kg"],
    ["decimals", [kg(62.5), kg(65)], "@ 62.5–65 kg"],
    ["weightless rows are ignored", [kg(null), kg(60), kg(null), kg(100)], "@ 60–100 kg"],
    ["a warm-up row counts like any other", [kg(20), kg(100), kg(100)], "@ 20–100 kg"],
    ["pounds", [lb(135), lb(225)], "@ 135–225 lb"],
    ["mixed units are never converted or mixed", [kg(60), lb(135)], ""],
  ])("%s", (_name, rows, expected) => {
    expect(plannedWeightText(rows)).toBe(expected);
  });
});

describe("10.2 AC3 — targetLine with a plan", () => {
  const T = (o: Partial<Targets> = {}): Targets => ({ ...none, ...o });

  it("is byte-identical to today with no second argument, an empty plan, or a weightless plan", () => {
    const targets = [
      T(),
      T({ targetSets: 4 }),
      T({ targetSets: 1 }),
      T({ targetRepsLow: 8, targetRepsHigh: 8 }),
      T({ targetRepsLow: 1, targetRepsHigh: 1 }),
      T({ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetRpe: 8, restSeconds: 120 }),
      T({ targetRpe: 9.5 }),
      T({ restSeconds: 0 }),
    ];
    for (const t of targets) {
      expect(targetLine(t, [])).toBe(targetLine(t));
      expect(targetLine(t, [kg(null), kg(null)])).toBe(targetLine(t));
    }
  });

  it.each([
    [T({ targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, targetRpe: 8.5, restSeconds: 120 }), [kg(100), kg(100), kg(100), kg(100)], "4 × 6–8 @ 100 kg · RPE 8.5 · 2:00"],
    [T({ targetSets: 3, targetRepsLow: 6, targetRepsHigh: 10 }), [kg(60), kg(80), kg(100)], "3 × 6–10 @ 60–100 kg"],
    [T({ targetSets: 3 }), [kg(60), kg(80), kg(100)], "3 sets @ 60–100 kg"],
    [T({ targetSets: 1 }), [kg(40)], "1 set @ 40 kg"],
    [T({ targetRepsLow: 8, targetRepsHigh: 10 }), [kg(20)], "8–10 reps @ 20 kg"],
    [T({ targetRepsLow: 1, targetRepsHigh: 1 }), [kg(20)], "1 rep @ 20 kg"],
    [T(), [kg(100)], "@ 100 kg"],
    [T({ targetRpe: 8 }), [kg(100)], "@ 100 kg · RPE 8"],
    [T({ targetSets: 2, targetRepsLow: 5, targetRepsHigh: 5 }), [kg(60), lb(135)], "2 × 5"],
  ])("%j with %j → %s", (targets, sets, expected) => {
    expect(targetLine(targets, sets)).toBe(expected);
  });
});
