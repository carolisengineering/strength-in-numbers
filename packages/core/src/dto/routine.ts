/**
 * Routine DTOs (Spec 09 §5). Request bodies are `z.strictObject`; responses
 * are `z.object` allowlists. Cross-item rules live in `RoutineWriteSchema`'s
 * superRefine (D16) so a client gets every problem in one 422.
 */
import { z } from "zod";
import { ExerciseIdSchema, RoutineIdSchema, RoutineItemIdSchema } from "../ids.js";
import { noControlChars } from "./exercise.js";
import { noControlCharsExceptWhitespace } from "./workout.js";
import { PLANNED_SETS_PER_ITEM_MAX, PlannedSetInputSchema, PlannedSetSchema } from "./planned-set.js";
import { QUICK_LINE_KEYS } from "../plannedSets.js";
import { RoutineSectionInputSchema, ROUTINE_SECTIONS_MAX, SECTION_KEY_PATTERN } from "./routine-section.js";
import { sectionOrderViolations, sectionSpanViolations } from "../sections.js";

export const ROUTINE_NAME_MAX = 80;
export const ROUTINE_NOTES_MAX = 2000;
export const ROUTINE_ITEM_NOTES_MAX = 500;
export const ROUTINES_PER_USER_MAX = 50;
export const ROUTINE_ITEMS_MAX = 30;
export const SUPERSET_GROUP_MEMBERS_MAX = 8;
export const SUPERSET_GROUP_VALUE_MAX = 99;

const TargetFields = {
  targetSets: z.number().int().min(1).max(20).nullable().optional(),
  targetRepsLow: z.number().int().min(1).max(100).nullable().optional(),
  targetRepsHigh: z.number().int().min(1).max(100).nullable().optional(),
  targetRpe: z.number().min(6).max(10).multipleOf(0.5).nullable().optional(),
  restSeconds: z.number().int().min(0).max(900).nullable().optional(),
  supersetGroup: z.number().int().min(1).max(SUPERSET_GROUP_VALUE_MAX).nullable().optional(),
};

/** One item in a POST/PUT body. Position is the array index; never sent (AC11). */
export const RoutineItemInputSchema = z.strictObject({
  exerciseId: ExerciseIdSchema,
  ...TargetFields,
  notes: z
    .string()
    .min(1)
    .max(ROUTINE_ITEM_NOTES_MAX)
    .refine(noControlCharsExceptWhitespace, "control characters not allowed")
    .nullable()
    .optional(),
  /** Spec 09.1 — the row form. Send this OR the quick-line fields, never both (AC7, by key presence). */
  sets: z.array(PlannedSetInputSchema).max(PLANNED_SETS_PER_ITEM_MAX).optional(),
  /** Spec 09.2 — names a declared `sections[*].key`; `null` / absent = loose. Request-local, never stored. */
  sectionKey: z.string().regex(SECTION_KEY_PATTERN).nullable().optional(),
});
export type RoutineItemInput = z.infer<typeof RoutineItemInputSchema>;

/** POST /v1/routines and PUT /v1/routines/{id} body — the whole routine, replaced as one (D2). */
export const RoutineWriteSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(ROUTINE_NAME_MAX)
      .refine(noControlChars, "control characters not allowed"),
    notes: z
      .string()
      .min(1)
      .max(ROUTINE_NOTES_MAX)
      .refine(noControlCharsExceptWhitespace, "control characters not allowed")
      .nullable()
      .optional(),
    /** Spec 09.2 — the routine's whole section list (D6). NOT nullable; absent = none. */
    sections: z.array(RoutineSectionInputSchema).max(ROUTINE_SECTIONS_MAX).optional(),
    items: z.array(RoutineItemInputSchema).min(1).max(ROUTINE_ITEMS_MAX),
  })
  .superRefine((doc, ctx) => {
    // Per item: reps both-or-neither, low ≤ high (§6.2 step 2).
    doc.items.forEach((it, i) => {
      const low = it.targetRepsLow ?? null;
      const high = it.targetRepsHigh ?? null;
      if (low !== null && high === null) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "targetRepsHigh"],
          message: "required when targetRepsLow is set",
        });
      } else if (low === null && high !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "targetRepsLow"],
          message: "required when targetRepsHigh is set",
        });
      } else if (low !== null && high !== null && low > high) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "targetRepsLow"],
          message: "must be at most targetRepsHigh",
        });
      }
    });
    // Spec 09.1 AC7 / AC4: one form per item; per-row pair rules.
    doc.items.forEach((it, i) => {
      if (it.sets === undefined) return;
      if (QUICK_LINE_KEYS.some((k) => Object.hasOwn(it, k))) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "sets"],
          message: "send either sets or the quick-line fields (targetSets, targetRepsLow, targetRepsHigh), not both",
        });
      }
      it.sets.forEach((row, j) => {
        const lo = row.repsLow ?? null;
        const hi = row.repsHigh ?? null;
        if (lo !== null && hi === null) {
          ctx.addIssue({ code: "custom", path: ["items", i, "sets", j, "repsHigh"], message: "required when repsLow is set" });
        } else if (lo === null && hi !== null) {
          ctx.addIssue({ code: "custom", path: ["items", i, "sets", j, "repsLow"], message: "required when repsHigh is set" });
        } else if (lo !== null && hi !== null && lo > hi) {
          ctx.addIssue({ code: "custom", path: ["items", i, "sets", j, "repsLow"], message: "must be at most repsHigh" });
        }
        const w = row.weight ?? null;
        const u = row.weightUnit ?? null;
        if (w !== null && u === null) {
          ctx.addIssue({ code: "custom", path: ["items", i, "sets", j, "weightUnit"], message: "required when weight is set" });
        } else if (w === null && u !== null) {
          ctx.addIssue({ code: "custom", path: ["items", i, "sets", j, "weight"], message: "required when weightUnit is set" });
        }
      });
    });
    // Across items: every distinct group has 2..8 members (D9).
    const members = new Map<number, number[]>();
    doc.items.forEach((it, i) => {
      const g = it.supersetGroup ?? null;
      if (g === null) return;
      const list = members.get(g) ?? [];
      list.push(i);
      members.set(g, list);
    });
    for (const indexes of members.values()) {
      if (indexes.length === 1) {
        ctx.addIssue({
          code: "custom",
          path: ["items", indexes[0]!, "supersetGroup"],
          message: "a superset group needs at least 2 members",
        });
      }
      for (const i of indexes.slice(SUPERSET_GROUP_MEMBERS_MAX)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "supersetGroup"],
          message: `a superset group has at most ${SUPERSET_GROUP_MEMBERS_MAX} members`,
        });
      }
    }
    // Spec 09.2 AC5–AC8. Keys resolve through a Map: `constructor` / `__proto__` match the key pattern.
    const keyIndex = new Map<string, number>();
    (doc.sections ?? []).forEach((s, j) => {
      if (keyIndex.has(s.key)) {
        ctx.addIssue({ code: "custom", path: ["sections", j, "key"], message: "must be unique within the routine" });
      } else {
        keyIndex.set(s.key, j);
      }
    });
    // refs[i]: section index, null (loose), or undefined (unresolved — already reported once).
    const refs: (number | null | undefined)[] = doc.items.map((it, i) => {
      const key = it.sectionKey ?? null;
      if (key === null) return null;
      const j = keyIndex.get(key);
      // A key that fails the pattern was already reported by the field schema; don't report it twice.
      if (j === undefined && SECTION_KEY_PATTERN.test(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "sectionKey"],
          message: "must name a section declared in sections",
        });
      }
      return j;
    });
    const resolved = doc.items.flatMap((_, i) => (refs[i] === undefined ? [] : [i]));
    const resolvedRefs = resolved.map((i) => refs[i] as number | null);
    for (const k of sectionOrderViolations(resolvedRefs)) {
      ctx.addIssue({
        code: "custom",
        path: ["items", resolved[k]!, "sectionKey"],
        message: "list loose exercises first, then each section in order",
      });
    }
    const resolvedGroups = resolved.map((i) => doc.items[i]!.supersetGroup ?? null);
    for (const k of sectionSpanViolations(resolvedGroups, resolvedRefs)) {
      ctx.addIssue({
        code: "custom",
        path: ["items", resolved[k]!, "supersetGroup"],
        message: "a superset can't span sections",
      });
    }
  });
export type RoutineWrite = z.infer<typeof RoutineWriteSchema>;

export const RoutineItemSchema = z.object({
  id: RoutineItemIdSchema,
  position: z.number().int().min(0),
  exerciseId: ExerciseIdSchema,
  targetSets: z.number().int().nullable(),
  targetRepsLow: z.number().int().nullable(),
  targetRepsHigh: z.number().int().nullable(),
  /** Decimal on the wire (8.5); stored as tenths (D5). */
  targetRpe: z.number().nullable(),
  restSeconds: z.number().int().nullable(),
  /** Dense 1, 2, 3 … on a routine (D9). */
  supersetGroup: z.number().int().nullable(),
  notes: z.string().nullable(),
  /** Spec 09.1 — the planned sets, ordered by position. Always an array; `[]` = no plan. */
  sets: z.array(PlannedSetSchema),
});
export type RoutineItem = z.infer<typeof RoutineItemSchema>;

export const RoutineSchema = z.object({
  id: RoutineIdSchema,
  name: z.string(),
  notes: z.string().nullable(),
  items: z.array(RoutineItemSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Routine = z.infer<typeof RoutineSchema>;

export const RoutineListResponseSchema = z.object({ routines: z.array(RoutineSchema) });
export type RoutineListResponse = z.infer<typeof RoutineListResponseSchema>;
