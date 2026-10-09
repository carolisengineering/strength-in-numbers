/**
 * Routine DTOs (Spec 09 §5). Request bodies are `z.strictObject`; responses
 * are `z.object` allowlists. Cross-item rules live in `RoutineWriteSchema`'s
 * superRefine (D16) so a client gets every problem in one 422.
 */
import { z } from "zod";
import { ExerciseIdSchema, RoutineIdSchema, RoutineItemIdSchema } from "../ids.js";
import { noControlChars } from "./exercise.js";
import { noControlCharsExceptWhitespace } from "./workout.js";

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
