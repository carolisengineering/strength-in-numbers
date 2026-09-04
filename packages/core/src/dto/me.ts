/**
 * The `/v1/me` DTO (Spec 01 §5) — the reference pattern every later DTO copies:
 * a Zod schema is the source of truth, the TS type is `z.infer` of it, and the
 * API validates with the same schema the client imports.
 *
 * Wire fields are camelCase (DESIGN §6); the API maps them to/from snake_case DB
 * columns. Spec 03.0 emits the OpenAPI 3.1 document *from* this schema (no
 * codegen); `/v1/me` is migrated onto it there.
 */
import { z } from "zod";
import { UNIT_PREFERENCE_VALUES } from "../enums.js";
import { UserIdSchema } from "../ids.js";

/** Response body of `GET /v1/me` and `PATCH /v1/me`. */
export const MeSchema = z.object({
  id: UserIdSchema,
  email: z.email(),
  displayName: z.string().max(80).nullable(),
  unitPreference: z.enum(UNIT_PREFERENCE_VALUES),
  timezone: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  /**
   * Present (and `true`) only on the response that provisioned the row
   * (Spec 01 §5). Absent everywhere else; consumers treat absent and `false`
   * identically.
   */
  isNewUser: z.boolean().optional(),
});
export type Me = z.infer<typeof MeSchema>;

/**
 * True when `tz` is a zone the host's ICU data recognises. `Intl` is ECMA-402,
 * not a Node builtin, so this passes the `@sin/core` purity check. Spec 03.0 §6.4
 * moves this constraint out of the `/v1/me` handler and into the schema — the
 * schema is the contract, so the rule belongs in it.
 */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Request body of `PATCH /v1/me`. All fields optional; unknown keys rejected. */
export const UpdateMeSchema = z.strictObject({
  displayName: z.string().max(80).nullable().optional(),
  unitPreference: z.enum(UNIT_PREFERENCE_VALUES).optional(),
  timezone: z
    .string()
    .min(1)
    .refine(isValidTimeZone, { message: "must be a valid IANA time zone" })
    .optional(),
});
export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;
