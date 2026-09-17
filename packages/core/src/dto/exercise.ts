/**
 * Exercise-catalog DTOs (Spec 03.1 §5) — same pattern as `dto/me.ts`: the Zod
 * schema is the source of truth, the TS type is `z.infer` of it, and the API
 * validates with the same schema the client (Specs 05/06) imports.
 *
 * Wire fields are camelCase (DESIGN §6); the API maps them to/from the
 * snake_case catalog columns. Spec 03.0 emits the OpenAPI 3.1 document *from*
 * these schemas (no codegen). `z.object` (not `.strict()`) so the API response
 * serializer treats each as a field allowlist (Spec 03.0 §6.5).
 */
import { z } from "zod";
import { MODALITY_VALUES } from "../enums.js";
import { ExerciseIdSchema, UserIdSchema } from "../ids.js";

/**
 * True when `s` contains no C0 control character (code points 0x00-0x1F) and no
 * DEL (0x7F). A plain predicate — checked with char codes rather than a
 * control-character regex literal — so it can be reused outside Zod: the seed
 * input schema (Spec 03.1 §6.3) and the 03.2 custom-create endpoint both apply
 * it.
 */
export const noControlChars = (s: string): boolean => {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
};

/**
 * A catalog display name: 1–120 chars, no control characters. The API stores it
 * verbatim — output-encoding at render time is Spec 06's job — so this bound is
 * the point-of-entry limit on abuse and payload bloat. Shared by `ExerciseSchema`
 * here, the seed, and 03.2.
 */
export const CatalogName = z
  .string()
  .min(1)
  .max(120)
  .refine(noControlChars, "control characters not allowed");

/**
 * One catalog exercise. `isActive: false` rows are returned only in an
 * `updated_since` delta (as tombstones the client drops) — never in a full pull
 * (§6.1).
 */
export const ExerciseSchema = z.object({
  id: ExerciseIdSchema,
  catalogKey: z.string().min(1).nullable(), // set for curated rows, null for custom
  ownerUserId: UserIdSchema.nullable(), // null = global/curated
  name: CatalogName,
  modality: z.enum(MODALITY_VALUES),
  primaryMuscleId: z.string().nullable(),
  secondaryMuscleIds: z.array(z.string()), // muscle_group ids, authoring order (§6.1)
  equipmentId: z.string().nullable(),
  isActive: z.boolean(),
  // Spec 03.2 §5/§6 D9 — null unless this row is a copy-on-write fork of a global
  // row. Never server-side-filtered from GET /v1/exercises; suppressing a forked
  // origin from a picker is a client-side rule (Spec 06).
  forkedFromExerciseId: ExerciseIdSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

/**
 * The muscle-id cross-field rule shared by `CreateExerciseSchema.superRefine`
 * (full body) and the server-side merge-then-validate step for `PATCH` and the
 * `/fork` overlay (Spec 03.2 §6) — a partial `UpdateExerciseSchema` body can't
 * see the base row's current values, so this same pure check re-runs against the
 * *merged* result there instead of at parse time.
 */
export interface MuscleFieldIssue {
  path: ["secondaryMuscleIds"];
  message: string;
}

/** Same cap as `CreateExerciseSchema`/`UpdateExerciseSchema`'s `.max(4)`, restated
 * here so the merge-then-validate path (PATCH, fork overlay) enforces it too —
 * those paths never re-run the Zod schema against the merged result, only this
 * function. Additive to the schema-level `.max(4)`, not a replacement: the
 * schema still gives the client early feedback on a body that is over-cap by
 * itself. */
const MAX_SECONDARY_MUSCLE_IDS = 4;

export function muscleIdCrossFieldIssues(val: {
  primaryMuscleId: string | null;
  secondaryMuscleIds: string[];
}): MuscleFieldIssue[] {
  const issues: MuscleFieldIssue[] = [];
  const seen = new Set<string>();
  for (const id of val.secondaryMuscleIds) {
    if (seen.has(id)) {
      issues.push({ path: ["secondaryMuscleIds"], message: "duplicate muscle id" });
    }
    seen.add(id);
  }
  if (val.primaryMuscleId !== null && val.secondaryMuscleIds.includes(val.primaryMuscleId)) {
    issues.push({ path: ["secondaryMuscleIds"], message: "must not restate primaryMuscleId" });
  }
  if (val.secondaryMuscleIds.length > MAX_SECONDARY_MUSCLE_IDS) {
    issues.push({
      path: ["secondaryMuscleIds"],
      message: `at most ${MAX_SECONDARY_MUSCLE_IDS} secondary muscle ids`,
    });
  }
  return issues;
}

/** `POST /v1/exercises` body — a full custom-exercise definition (Spec 03.2 §5). */
export const CreateExerciseSchema = z
  .object({
    name: CatalogName,
    modality: z.enum(MODALITY_VALUES),
    primaryMuscleId: z.string().nullable().default(null),
    secondaryMuscleIds: z.array(z.string()).max(4).default([]),
    equipmentId: z.string().nullable().default(null),
  })
  .strict()
  .superRefine((val, ctx) => {
    for (const issue of muscleIdCrossFieldIssues(val)) {
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  });
export type CreateExercise = z.infer<typeof CreateExerciseSchema>;

/**
 * `PATCH /v1/exercises/{id}` body and the `/fork` overlay body — same fields as
 * `CreateExerciseSchema`, all optional, **no** `.superRefine`: a partial body
 * can't see the base row's current values, so the cross-field check re-runs
 * server-side against the merged result instead (Spec 03.2 §6).
 */
export const UpdateExerciseSchema = z
  .object({
    name: CatalogName,
    modality: z.enum(MODALITY_VALUES),
    primaryMuscleId: z.string().nullable(),
    secondaryMuscleIds: z.array(z.string()).max(4),
    equipmentId: z.string().nullable(),
  })
  .partial()
  .strict();
export type UpdateExercise = z.infer<typeof UpdateExerciseSchema>;

/**
 * Hard per-user active-custom-exercise cap (Spec 03.2 D15) — a single budget
 * shared by `POST /v1/exercises` and `POST /v1/exercises/{id}/fork`. A code
 * constant, not env-configurable: raising it is a reviewed decision tied to the
 * unpaginated `GET /v1/exercises` read (Spec 03.1 §6.1), not an ops knob.
 */
export const MAX_CUSTOM_EXERCISES_PER_USER = 500;

/** A muscle-group reference row (`GET /v1/muscle-groups`). */
export const MuscleGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayOrder: z.number().int(),
});
export type MuscleGroup = z.infer<typeof MuscleGroupSchema>;

/** An equipment reference row (`GET /v1/equipment`). */
export const EquipmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayOrder: z.number().int(),
});
export type Equipment = z.infer<typeof EquipmentSchema>;

/**
 * `GET /v1/exercises` 200 body. `serverTime` is the value the client persists and
 * sends back as the next `updated_since` cursor (§6.1).
 */
export const ExercisesResponse = z.object({
  exercises: z.array(ExerciseSchema),
  serverTime: z.iso.datetime({ offset: true }),
});
export type ExercisesResponseBody = z.infer<typeof ExercisesResponse>;

/**
 * `GET /v1/exercises` query string. A malformed `updated_since` surfaces as
 * `422 validation-error` through the Spec 03.0 Zod error mapping.
 */
/**
 * `z.iso.datetime` admits year `0000` and offsets up to `±23:59`; Postgres
 * `timestamptz` rejects both (`time zone displacement out of range` beyond
 * `±15:59`, and there is no year 0). Refining here keeps such cursors a `422`
 * rather than a `500` from the `::timestamptz` cast.
 */
export const isPostgresTimestamptz = (s: string): boolean => {
  if (s.startsWith("0000-")) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(s);
  if (!offset) return true; // `Z`
  return Number(offset[2]) <= 15;
};

export const UpdatedSinceQuery = z.object({
  updated_since: z.iso
    .datetime({ offset: true })
    .refine(isPostgresTimestamptz, "timestamp out of range")
    .optional(),
});
export type UpdatedSinceQueryInput = z.infer<typeof UpdatedSinceQuery>;

/**
 * `GET /v1/muscle-groups` 200 body. The reference tables have no `updated_since`
 * delta — they are tiny and change only on a deploy, so a client re-fetches
 * whenever its `If-None-Match` / `304` check misses (§6.2).
 */
export const MuscleGroupsResponse = z.object({
  muscleGroups: z.array(MuscleGroupSchema),
});
export type MuscleGroupsResponseBody = z.infer<typeof MuscleGroupsResponse>;

/** `GET /v1/equipment` 200 body (§6.2). */
export const EquipmentResponse = z.object({
  equipment: z.array(EquipmentSchema),
});
export type EquipmentResponseBody = z.infer<typeof EquipmentResponse>;
