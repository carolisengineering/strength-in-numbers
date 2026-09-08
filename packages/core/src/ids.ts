/**
 * Branded id types.
 *
 * At runtime an id is just a string. `brandId(name)` gives it a compile-time tag
 * so TypeScript refuses a raw `string` — or a differently-branded id — where a
 * specific id is expected, until it goes through `parse`. Zero runtime cost;
 * catches "passed the wrong id" bugs once several id params sit together.
 *
 * Spec 02 shipped the mechanism plus `UserId`; Spec 03.1 adds `ExerciseId`.
 * Every later spec adds its own the same way — one `brandId(name)` call plus the
 * four re-exports at the bottom of this file.
 *
 * Validation is `z.guid()` — the lenient 8-4-4-4-12 hex shape, matching Zod 3's
 * old `z.string().uuid()`. We deliberately do NOT use Zod 4's `z.uuid()`, which
 * additionally enforces the RFC-9562 version/variant nibbles: ids are minted
 * app-side (uuidv7, Spec 01), fixtures legitimately use v4, sentinel/nil ids may
 * appear in seed data, and the version nibble carries no authorization meaning.
 * A strict-v7 guard, if ever needed, is one additive `.regex(...)` here.
 */
import { z } from "zod";

export function brandId<N extends string>(name: N) {
  // `name` is kept for call-site readability and future per-brand error text.
  void name;
  const schema = z.guid().brand<N>();
  type Branded = z.infer<typeof schema>;
  return {
    /** Zod schema; compose it into DTO schemas (`id: UserIdSchema`). */
    schema,
    /** Parse + validate, or throw `ZodError`. */
    parse: (value: string): Branded => schema.parse(value) as Branded,
    /** Type guard — true when `value` is a well-formed id of this brand. */
    is: (value: string): value is Branded => schema.safeParse(value).success,
  };
}

/** The shape returned by `brandId` for a given brand name. */
export type BrandedId<N extends string> = ReturnType<typeof brandId<N>>;

const userId = brandId("UserId");

export const UserIdSchema = userId.schema;
export type UserId = z.infer<typeof UserIdSchema>;
export const parseUserId = userId.parse;
export const isUserId = userId.is;

const exerciseId = brandId("ExerciseId");

export const ExerciseIdSchema = exerciseId.schema;
export type ExerciseId = z.infer<typeof ExerciseIdSchema>;
export const parseExerciseId = exerciseId.parse;
export const isExerciseId = exerciseId.is;
