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
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

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
