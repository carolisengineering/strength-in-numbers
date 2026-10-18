import { describe, expect, it } from "vitest";
import { setChangeAffectsRecords, type RecordRelevantSet } from "../src/records.js";

const working = (over: Partial<RecordRelevantSet> = {}): RecordRelevantSet => ({ setType: "working", reps: 5, weightKgMilli: 100_000, ...over });
const warmup = (over: Partial<RecordRelevantSet> = {}): RecordRelevantSet => ({ ...working(over), setType: "warmup", ...over });

describe("07.4 AC8 — setChangeAffectsRecords", () => {
  it.each<[string, RecordRelevantSet | null, RecordRelevantSet | null, boolean]>([
    ["nothing before or after", null, null, false],
    ["create a non-working set", null, warmup(), false],
    ["delete a non-working set", warmup(), null, false],
    ["working → working, nothing relevant changed", working(), working(), false],
    ["warm-up → warm-up with new numbers", warmup(), warmup({ reps: 9, weightKgMilli: 1 }), false],
    ["create a working set", null, working(), true],
    ["delete a working set", working(), null, true],
    ["working → warm-up (demote)", working(), warmup(), true],
    ["warm-up → working (promote)", warmup(), working(), true],
    ["reps change", working(), working({ reps: 6 }), true],
    ["weight change", working(), working({ weightKgMilli: 100_001 }), true],
    ["weight null → number", working({ weightKgMilli: null }), working(), true],
    ["reps number → null", working(), working({ reps: null }), true],
  ])("%s", (_name, before, after, expected) => {
    expect(setChangeAffectsRecords(before, after)).toBe(expected);
  });
});
