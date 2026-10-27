import { describe, expect, it } from "vitest";
import {
  HevyLinkBeginBodySchema,
  HevyLinkBeginSchema,
  HevyLinkCompleteSchema,
  HevyLinkStateSchema,
  HevyMappingPatchSchema,
  HevyMappingPutSchema,
  HevyMappingSchema,
  HevyPairInputSchema,
  HevySectionRuleSchema,
  HevyStatusSchema,
} from "../src/index.js";

const EXERCISE = "0192a1b2-0000-7000-8000-000000000001";
const pairRead = {
  hevyTemplateId: "05293BCA",
  hevyTitle: "Bench Press (Barbell)",
  hevyType: "weight_reps",
  role: "exercise",
  exerciseId: EXERCISE,
  exerciseActive: true,
  measureRule: null,
  exportAs: true,
};
const marker = {
  hevyTemplateId: "9F8E7D6C",
  hevyTitle: "Warmup",
  hevyType: "reps_only",
  role: "warmup_placeholder",
  exerciseId: null,
  exerciseActive: null,
  measureRule: null,
  exportAs: false,
};
const pairInput = Object.fromEntries(Object.entries(pairRead).filter(([key]) => key !== "exerciseActive"));
const FINGERPRINT = `v1:${"a".repeat(64)}`;

describe("19.0 §5 — the HTTP DTOs accept the spec's examples", () => {
  it("the mapping read (§5.2)", () => {
    expect(HevyMappingSchema.safeParse({ pairs: [pairRead, marker], sectionRules: [{ name: "Accessory", treatment: "notes_on_first" }] }).success).toBe(true);
  });

  it("the mapping replace (§5.3) and patch (§5.4)", () => {
    expect(HevyMappingPutSchema.safeParse({ pairs: [pairInput], sectionRules: [] }).success).toBe(true);
    expect(HevyMappingPatchSchema.safeParse({ upsert: [pairInput] }).success).toBe(true);
    expect(HevyMappingPatchSchema.safeParse({ remove: ["05293BCA"] }).success).toBe(true);
  });

  it("status, link state, begin and complete (§5.1, §5.5)", () => {
    expect(HevyStatusSchema.safeParse({ enabled: true, pairCount: 212, linkCount: 0, recordsStale: false }).success).toBe(true);
    expect(HevyLinkStateSchema.safeParse({ state: "sent", hevyWorkoutId: "b459cba5", origin: "sent", syncedAt: "2026-10-27T12:00:00.000Z" }).success).toBe(true);
    expect(HevyLinkStateSchema.safeParse({ state: "none", hevyWorkoutId: null, origin: null, syncedAt: null }).success).toBe(true);
    expect(HevyLinkBeginBodySchema.safeParse({}).success).toBe(true);
    expect(HevyLinkBeginBodySchema.safeParse({ relink: true }).success).toBe(true);
    expect(HevyLinkBeginSchema.safeParse({ mode: "create", hevyWorkoutId: null, staleClaim: false, fingerprint: FINGERPRINT }).success).toBe(true);
    expect(HevyLinkCompleteSchema.safeParse({ hevyWorkoutId: "b459cba5", fingerprint: FINGERPRINT }).success).toBe(true);
  });
});

describe("19.0 D19 — an unsupported Hevy template is a skip with no type", () => {
  it("the pair schemas take a null hevyType (the server refuses it on any role but skip)", () => {
    const skip = { ...pairInput, role: "skip", exerciseId: null, exportAs: false, hevyType: null };
    expect(HevyPairInputSchema.safeParse(skip).success).toBe(true);
    expect(HevyMappingSchema.safeParse({ pairs: [{ ...skip, exerciseActive: null }], sectionRules: [] }).success).toBe(true);
  });
});

describe("19.0 AC23 / AC34 — the request schemas refuse", () => {
  it("an apiKey on the mapping replace (strict)", () => {
    expect(HevyMappingPutSchema.safeParse({ pairs: [], sectionRules: [], apiKey: "k" }).success).toBe(false);
    expect(HevyPairInputSchema.safeParse({ ...pairInput, api_key: "k" }).success).toBe(false);
  });

  it("a malformed fingerprint or a 65-character Hevy id on complete", () => {
    expect(HevyLinkCompleteSchema.safeParse({ hevyWorkoutId: "b459cba5", fingerprint: "v1:xyz" }).success).toBe(false);
    expect(HevyLinkCompleteSchema.safeParse({ hevyWorkoutId: "x".repeat(65), fingerprint: FINGERPRINT }).success).toBe(false);
    expect(HevyLinkCompleteSchema.safeParse({ hevyWorkoutId: "a\u0000b", fingerprint: FINGERPRINT }).success).toBe(false);
  });

  it("an empty patch", () => {
    expect(HevyMappingPatchSchema.safeParse({}).success).toBe(false);
  });

  it("relink other than true on begin", () => {
    expect(HevyLinkBeginBodySchema.safeParse({ relink: false }).success).toBe(false);
  });

  it("a Hevy title over 200 characters or with a control character", () => {
    expect(HevyPairInputSchema.safeParse({ ...pairInput, hevyTitle: "x".repeat(201) }).success).toBe(false);
    expect(HevyPairInputSchema.safeParse({ ...pairInput, hevyTitle: "Bench\u0007" }).success).toBe(false);
  });

  it("more pairs or rules than the limits", () => {
    const pairs = Array.from({ length: 2001 }, (_, i) => ({ ...pairInput, hevyTemplateId: `T${i}` }));
    expect(HevyMappingPutSchema.safeParse({ pairs, sectionRules: [] }).success).toBe(false);
    const sectionRules = Array.from({ length: 21 }, (_, i) => ({ name: `S${i}`, treatment: "notes_on_first" }));
    expect(HevyMappingPutSchema.safeParse({ pairs: [], sectionRules }).success).toBe(false);
  });

  it("a section rule name that is blank or longer than a section name (40, after trimming)", () => {
    expect(HevySectionRuleSchema.safeParse({ name: "   ", treatment: "notes_on_first" }).success).toBe(false);
    expect(HevySectionRuleSchema.safeParse({ name: "x".repeat(41), treatment: "notes_on_first" }).success).toBe(false);
    expect(HevySectionRuleSchema.safeParse({ name: ` ${"x".repeat(40)} `, treatment: "notes_on_first" }).success).toBe(true);
  });
});
