import { describe, expect, it } from "vitest";
import {
  ROUTINE_ITEMS_MAX,
  ROUTINE_NAME_MAX,
  ROUTINES_PER_USER_MAX,
  RoutineItemInputSchema,
  RoutineSchema,
  RoutineWriteSchema,
  SUPERSET_GROUP_MEMBERS_MAX,
} from "../src/dto/routine.js";

const EX = "018fcb3e-3b8a-7d6e-9c1a-000000000010";
const item = (over: Record<string, unknown> = {}) => ({ exerciseId: EX, ...over });
const body = (over: Record<string, unknown> = {}) => ({ name: "Push A", items: [item()], ...over });
const paths = (r: ReturnType<typeof RoutineWriteSchema.safeParse>) =>
  r.success ? [] : r.error.issues.map((i) => i.path.join("."));

describe("AC6 — name rules", () => {
  it("trims, then requires 1..80 chars", () => {
    expect(RoutineWriteSchema.safeParse(body({ name: "  Push A  " })).data?.name).toBe("Push A");
    expect(RoutineWriteSchema.safeParse(body({ name: "   " })).success).toBe(false);
    expect(RoutineWriteSchema.safeParse(body({ name: "a".repeat(ROUTINE_NAME_MAX) })).success).toBe(true);
    expect(RoutineWriteSchema.safeParse(body({ name: "a".repeat(ROUTINE_NAME_MAX + 1) })).success).toBe(false);
  });
  it("rejects control characters in name, allows newlines in notes only", () => {
    expect(RoutineWriteSchema.safeParse(body({ name: "Push\u0000A" })).success).toBe(false);
    expect(RoutineWriteSchema.safeParse(body({ name: "Push\nA" })).success).toBe(false);
    expect(RoutineWriteSchema.safeParse(body({ notes: "line1\nline2" })).success).toBe(true);
    expect(RoutineWriteSchema.safeParse(body({ notes: "a\u0007b" })).success).toBe(false);
  });
});

describe("AC7 / AC11 — item count, position is never sent, constants", () => {
  it("holds the §5 values", () => {
    expect(ROUTINES_PER_USER_MAX).toBe(50);
    expect(ROUTINE_ITEMS_MAX).toBe(30);
    expect(SUPERSET_GROUP_MEMBERS_MAX).toBe(8);
  });
  it("[] items → issue on items; 30 ok; 31 → issue on items", () => {
    expect(paths(RoutineWriteSchema.safeParse(body({ items: [] })))).toEqual(["items"]);
    expect(RoutineWriteSchema.safeParse(body({ items: Array(30).fill(item()) })).success).toBe(true);
    expect(paths(RoutineWriteSchema.safeParse(body({ items: Array(31).fill(item()) })))).toEqual(["items"]);
  });
  it("AC11 — a position key on an item is an unknown key, reported at the item with the key in metadata", () => {
    const r = RoutineWriteSchema.safeParse(body({ items: [item({ position: 0 })] }));
    expect(paths(r)).toEqual(["items.0"]);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ code: "unrecognized_keys", keys: ["position"] });
  });
  it("an unknown top-level key is rejected", () => {
    expect(RoutineWriteSchema.safeParse(body({ id: EX })).success).toBe(false);
  });
});

describe("AC9 — target validation matrix", () => {
  it.each([
    ["targetSets", 0, false],
    ["targetSets", 1, true],
    ["targetSets", 20, true],
    ["targetSets", 21, false],
    ["targetSets", 4.5, false],
    ["targetSets", "4", false],
    ["restSeconds", -1, false],
    ["restSeconds", 0, true],
    ["restSeconds", 900, true],
    ["restSeconds", 901, false],
    ["supersetGroup", 0, false],
    ["supersetGroup", 100, false],
    ["notes", "", false],
    ["notes", "a", true],
    ["notes", "a".repeat(500), true],
    ["notes", "a".repeat(501), false],
    ["targetRpe", "8.5", false],
  ] as const)("%s = %j → valid %s", (field, value, ok) => {
    const r = RoutineItemInputSchema.safeParse(item({ [field]: value }));
    expect(r.success).toBe(ok);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual([field]);
  });
  it("null or omitted target means no target", () => {
    expect(RoutineItemInputSchema.safeParse(item({ targetSets: null, targetRpe: null })).success).toBe(true);
  });
  it("reps: both-or-neither, low ≤ high, reported on the item field", () => {
    const one = RoutineWriteSchema.safeParse(body({ items: [item({ targetRepsLow: 6 })] }));
    expect(paths(one)).toEqual(["items.0.targetRepsHigh"]);
    const other = RoutineWriteSchema.safeParse(body({ items: [item({ targetRepsHigh: 8 })] }));
    expect(paths(other)).toEqual(["items.0.targetRepsLow"]);
    const inverted = RoutineWriteSchema.safeParse(body({ items: [item({ targetRepsLow: 9, targetRepsHigh: 8 })] }));
    expect(paths(inverted)).toEqual(["items.0.targetRepsLow"]);
    expect(
      RoutineWriteSchema.safeParse(body({ items: [item({ targetRepsLow: 8, targetRepsHigh: 8 })] })).success,
    ).toBe(true);
    expect(RoutineItemInputSchema.safeParse(item({ targetRepsLow: 0, targetRepsHigh: 8 })).success).toBe(false);
    expect(RoutineItemInputSchema.safeParse(item({ targetRepsLow: 1, targetRepsHigh: 101 })).success).toBe(false);
  });
});

describe("AC10 — targetRpe half steps only", () => {
  it.each([6, 6.5, 8.5, 10])("%s accepted", (v) => {
    expect(RoutineItemInputSchema.safeParse(item({ targetRpe: v })).success).toBe(true);
  });
  it.each([5.5, 8.3, 10.5, 8.25])("%s rejected on targetRpe", (v) => {
    const r = RoutineItemInputSchema.safeParse(item({ targetRpe: v }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["targetRpe"]);
  });
});

describe("AC12 — superset group sizes 2..8", () => {
  const groups = (gs: (number | null)[]) => body({ items: gs.map((g) => item({ supersetGroup: g })) });
  it("a group of one is reported on its only member", () => {
    expect(paths(RoutineWriteSchema.safeParse(groups([1, null, 2, 2])))).toEqual(["items.0.supersetGroup"]);
    expect(paths(RoutineWriteSchema.safeParse(groups([null, 5])))).toEqual(["items.1.supersetGroup"]);
  });
  it("two members, non-adjacent, is fine; [null, null] is fine", () => {
    expect(RoutineWriteSchema.safeParse(groups([1, null, 1])).success).toBe(true);
    expect(RoutineWriteSchema.safeParse(groups([null, null])).success).toBe(true);
  });
  it("8 members ok, the 9th is reported at its own index", () => {
    expect(RoutineWriteSchema.safeParse(groups(Array(8).fill(3))).success).toBe(true);
    expect(paths(RoutineWriteSchema.safeParse(groups(Array(9).fill(3))))).toEqual(["items.8.supersetGroup"]);
  });
  it("all issues are collected, not just the first", () => {
    const r = RoutineWriteSchema.safeParse(
      body({ items: [item({ supersetGroup: 1 }), item({ targetRepsLow: 5 })] }),
    );
    expect(paths(r).sort()).toEqual(["items.0.supersetGroup", "items.1.targetRepsHigh"]);
  });
});

describe("AC24-adjacent — RoutineSchema response shape", () => {
  it("parses a routine with one item and nullable targets", () => {
    const now = "2026-10-09T10:00:00.000Z";
    expect(() =>
      RoutineSchema.parse({
        id: "018fcb3e-3b8a-7d6e-9c1a-000000000001",
        name: "Push A",
        notes: null,
        createdAt: now,
        updatedAt: now,
        items: [
          {
            id: "018fcb3e-3b8a-7d6e-9c1a-000000000002",
            position: 0,
            exerciseId: EX,
            targetSets: 4,
            targetRepsLow: 6,
            targetRepsHigh: 8,
            targetRpe: 8.5,
            restSeconds: 120,
            supersetGroup: 1,
            notes: null,
          },
        ],
      }),
    ).not.toThrow();
  });
});
