/**
 * The `/v1/me` DTO (Spec 01 §5) — the reference pattern every later DTO copies:
 * a Zod schema is the source of truth, the TS type is `z.infer` of it, and the
 * API validates with the same schema the client imports.
 *
 * Wire fields are camelCase (DESIGN §6); the API maps them to/from snake_case DB
 * columns. When Spec 03 stands up OpenAPI→types codegen, the generated `Me` must
 * match this shape.
 */
import { z } from "zod";
import { UNIT_PREFERENCE_VALUES } from "../enums.js";
import { UserIdSchema } from "../ids.js";

/** Response body of `GET /v1/me` and `PATCH /v1/me`. */
export const MeSchema = z.object({
  id: UserIdSchema,
  email: z.string().email(),
  displayName: z.string().max(80).nullable(),
  unitPreference: z.enum(UNIT_PREFERENCE_VALUES),
  timezone: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  /**
   * Present (and `true`) only on the response that provisioned the row
   * (Spec 01 §5). Absent everywhere else; consumers treat absent and `false`
   * identically.
   */
  isNewUser: z.boolean().optional(),
});
export type Me = z.infer<typeof MeSchema>;

/** Request body of `PATCH /v1/me`. All fields optional; unknown keys rejected. */
export const UpdateMeSchema = z
  .object({
    displayName: z.string().max(80).nullable().optional(),
    unitPreference: z.enum(UNIT_PREFERENCE_VALUES).optional(),
    timezone: z.string().min(1).optional(),
  })
  .strict();
export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;
