import { describe, expect, it } from "vitest";
import {
  ROUTINE_SECTIONS_MAX, SECTION_KEY_PATTERN, SECTION_NAME_MAX, SECTION_NOTES_MAX,
  RoutineSectionInputSchema, RoutineWriteSchema, isRoutineSectionId, isWorkoutSectionId,
} from "../src/index.js";

const EX = "018fcb3e-3b8a-7d6e-9c1a-000000000010";
const item = (over: Record<string, unknown> = {}) => ({ exerciseId: EX, ...over });
const sec = (over: Record<string, unknown> = {}) => ({ key: "main", name: "Main", ...over });
const body = (over: Record<string, unknown> = {}) => ({ name: "Push A", items: [item()], ...over });
const paths = (r: ReturnType<typeof RoutineWriteSchema.safeParse>) =>
  r.success ? [] : r.error.issues.map((i) => i.path.join(".")).sort();

describe("AC5 — constants and branded ids", () => {
  it("holds the spec values", () => {
    expect([ROUTINE_SECTIONS_MAX, SECTION_NAME_MAX, SECTION_NOTES_MAX]).toEqual([8, 40, 2000]);
    expect(SECTION_KEY_PATTERN.source).toBe("^[A-Za-z0-9_-]{1,32}$");
  });
  it("section ids are guarded like every other brand", () => {
    expect(isRoutineSectionId("018fcb3e-3b8a-7d6e-9c1a-000000000001")).toBe(true);
    expect(isWorkoutSectionId("nope")).toBe(false);
  });
});

describe("AC5 — section field matrix", () => {
  it.each([
    ["key", "", false], ["key", "a", true], ["key", "a".repeat(32), true], ["key", "a".repeat(33), false],
    ["key", "has space", false], ["key", "ünï", false], ["key", "a_b-C9", true],
    ["name", "", false], ["name", "   ", false], ["name", "a", true], ["name", "a".repeat(40), true],
    ["name", "a".repeat(41), false], ["name", "tab\there", false], ["name", "new\nline", false],
    ["notes", "", false], ["notes", "a", true], ["notes", "a".repeat(2000), true], ["notes", "a".repeat(2001), false],
    ["notes", "line1\nline2\tTabbed\r\nCRLF", true], ["notes", "bell\u0007", false], ["notes", null, true],
  ] as const)("%s = %j → valid %s", (field, value, ok) => {
    const r = RoutineSectionInputSchema.safeParse(sec({ [field]: value }));
    expect(r.success).toBe(ok);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual([field]);
  });
  it("name is trimmed; notes may be absent; duplicate names are allowed", () => {
    expect(RoutineSectionInputSchema.safeParse(sec({ name: "  Warm-up  " })).data?.name).toBe("Warm-up");
    expect(RoutineSectionInputSchema.safeParse({ key: "k", name: "x" }).success).toBe(true);
    const r = RoutineWriteSchema.safeParse(body({ sections: [sec({ key: "a", name: "Same" }), sec({ key: "b", name: "Same" })] }));
    expect(r.success).toBe(true);
  });
  it("an unknown key on a section (id, position, sectionId) is rejected at the section", () => {
    for (const extra of ["id", "position", "sectionId"]) {
      const r = RoutineWriteSchema.safeParse(body({ sections: [sec({ [extra]: EX })] }));
      expect(paths(r)).toEqual(["sections.0"]);
    }
  });
  it("0 and 8 sections are fine; 9 → issue on `sections`; null → issue on `sections`", () => {
    const n = (k: number) => Array.from({ length: k }, (_, j) => sec({ key: `k${j}`, name: `S${j}` }));
    expect(RoutineWriteSchema.safeParse(body({ sections: n(0) })).success).toBe(true);
    expect(RoutineWriteSchema.safeParse(body({ sections: n(8) })).success).toBe(true);
    expect(paths(RoutineWriteSchema.safeParse(body({ sections: n(9) })))).toEqual(["sections"]);
    expect(paths(RoutineWriteSchema.safeParse(body({ sections: null })))).toEqual(["sections"]);
  });
  it("a duplicate key is an issue on the LATER section's key", () => {
    const r = RoutineWriteSchema.safeParse(body({ sections: [sec({ key: "a" }), sec({ key: "b" }), sec({ key: "a" })] }));
    expect(paths(r)).toEqual(["sections.2.key"]);
  });
  it("all issues of one body are reported together", () => {
    const r = RoutineWriteSchema.safeParse(body({ sections: [sec({ name: "" , notes: "" }), sec({ key: "b", name: "x".repeat(41) })] }));
    expect(paths(r)).toEqual(["sections.0.name", "sections.0.notes", "sections.1.name"]);
  });
  it("the legal maximum (8 × 40-char name × 2000-char note) parses", () => {
    const sections = Array.from({ length: 8 }, (_, j) => sec({ key: `k${j}`, name: "n".repeat(40), notes: "x".repeat(2000) }));
    expect(RoutineWriteSchema.safeParse(body({ sections })).success).toBe(true);
  });
});

describe("AC6 — an item's sectionKey must name a declared key", () => {
  const withKey = (sectionKey: unknown, sections: unknown = [sec()]) =>
    RoutineWriteSchema.safeParse(body({ sections, items: [item({ sectionKey })] }));
  it("declared → ok; null and absent → loose, ok", () => {
    expect(withKey("main").success).toBe(true);
    expect(withKey(null).success).toBe(true);
    expect(RoutineWriteSchema.safeParse(body({ sections: [sec()] })).success).toBe(true);
  });
  it("undeclared → issue on items.0.sectionKey (also when `sections` is absent)", () => {
    expect(paths(withKey("other"))).toEqual(["items.0.sectionKey"]);
    expect(paths(RoutineWriteSchema.safeParse(body({ items: [item({ sectionKey: "main" })] })))).toEqual(["items.0.sectionKey"]);
  });
  it.each(["", "has space", 7, true, "x".repeat(33)])("malformed %j → issue on items.0.sectionKey", (v) => {
    expect(paths(withKey(v))).toEqual(["items.0.sectionKey"]);
  });
  it("Review Focus 2 — Object.prototype names are not declared keys; a section may BE named __proto__", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(paths(withKey(k))).toEqual(["items.0.sectionKey"]);
    }
    const declared = RoutineWriteSchema.safeParse(
      body({ sections: [sec({ key: "__proto__" })], items: [item({ sectionKey: "__proto__" })] }),
    );
    expect(declared.success).toBe(true);
  });
});

describe("AC7 — items must be loose first, then each section as one contiguous run", () => {
  const two = [sec({ key: "a", name: "A" }), sec({ key: "b", name: "B" })];
  const doc = (keys: (string | null)[]) =>
    RoutineWriteSchema.safeParse(body({ sections: two, items: keys.map((k) => item({ sectionKey: k })) }));
  it.each([
    [[null, "a", "a", "b"]], [["a"]], [["b"]], [[null, null]], [["a", "b"]], [[null, "b"]],
  ])("valid %j", (keys) => {
    expect(doc(keys).success).toBe(true);
  });
  it.each([
    [["a", null], ["items.1.sectionKey"]],
    [["b", "a"], ["items.1.sectionKey"]],
    [["a", "b", "a"], ["items.2.sectionKey"]],
    [[null, "a", null, "a"], ["items.2.sectionKey"]],
  ])("invalid %j → %j", (keys, expected) => {
    expect(paths(doc(keys))).toEqual(expected);
  });
  it("an unresolved key raises no second (order) issue", () => {
    const r = RoutineWriteSchema.safeParse(body({ sections: two, items: [item({ sectionKey: "b" }), item({ sectionKey: "zzz" })] }));
    expect(paths(r)).toEqual(["items.1.sectionKey"]);
  });
});

describe("AC8 — a superset stays inside one section", () => {
  const two = [sec({ key: "a", name: "A" }), sec({ key: "b", name: "B" })];
  const doc = (rows: [string | null, number | null][]) =>
    RoutineWriteSchema.safeParse(
      body({ sections: two, items: rows.map(([k, g]) => item({ sectionKey: k, supersetGroup: g })) }),
    );
  it("same section → ok; both loose → ok", () => {
    expect(doc([["a", 1], ["a", 1]]).success).toBe(true);
    expect(doc([[null, 1], [null, 1], ["a", null]]).success).toBe(true);
  });
  it("across sections → issue on the later member's supersetGroup", () => {
    expect(paths(doc([["a", 1], ["b", 1]]))).toEqual(["items.1.supersetGroup"]);
  });
  it("loose + sectioned → issue on the sectioned (later) member", () => {
    expect(paths(doc([[null, 1], ["a", 1]]))).toEqual(["items.1.supersetGroup"]);
  });
  it("Spec 09's other group rules still apply (group of one, > 8 members)", () => {
    expect(paths(doc([["a", 1], ["b", null]]))).toEqual(["items.0.supersetGroup"]);
    const nine = Array.from({ length: 9 }, () => ["a", 3] as [string, number]);
    expect(paths(doc(nine))).toEqual(["items.8.supersetGroup"]);
  });
  it("a body with no sections and no sectionKey is exactly Spec 09/09.1 (AC11)", () => {
    expect(RoutineWriteSchema.safeParse(body()).success).toBe(true);
  });
});
