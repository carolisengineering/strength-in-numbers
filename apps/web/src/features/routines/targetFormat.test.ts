import { describe, expect, it } from "vitest";
import { ROUTINE_ITEM_NOTES_MAX, RoutineItemInputSchema } from "@sin/core";
import {
  formatReps,
  formatRest,
  itemAccessibleName,
  parseNotes,
  parseReps,
  parseRest,
  parseSets,
  REST_MESSAGE,
  RPE_CHOICES,
  routineSummary,
  targetLine,
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
