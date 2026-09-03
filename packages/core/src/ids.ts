/**
 * Branded id types.
 *
 * At runtime an id is just a string. `brandId(name)` gives it a compile-time tag
 * so TypeScript refuses a raw `string` — or a differently-branded id — where a
 * specific id is expected, until it goes through `parse`. Zero runtime cost;
 * catches "passed the wrong id" bugs once several id params sit together.
 *
 * Spec 02 ships the mechanism plus `UserId` (the only id this package can define
 * yet). Every later spec adds its own the same way, e.g.
 *
 *   const { parse: parseExerciseId } = brandId("ExerciseId");
 *
 * Validation is `z.string().uuid()` — any RFC-4122 UUID, not strictly v7. Ids are
 * minted app-side (uuidv7, Spec 01), fixtures legitimately use v4, and the
 * version nibble carries no authorization meaning. A strict-v7 guard, if ever
 * needed, is one additive `.regex(...)` here.
 */
import { z } from "zod";

export function brandId<N extends string>(name: N) {
  // `name` is kept for call-site readability and future per-brand error text.
  void name;
  const schema = z.string().uuid().brand<N>();
  return {
    /** Zod schema; compose it into DTO schemas (`id: UserIdSchema`). */
    schema,
    /** Parse + validate, or throw `ZodError`. */
    parse: (value: string): z.infer<typeof schema> => schema.parse(value),
    /** Type guard — true when `value` is a well-formed id of this brand. */
    is: (value: string): value is z.infer<typeof schema> => schema.safeParse(value).success,
  };
}

/** The shape returned by `brandId` for a given brand name. */
export type BrandedId<N extends string> = ReturnType<typeof brandId<N>>;

const userId = brandId("UserId");

export const UserIdSchema = userId.schema;
export type UserId = z.infer<typeof UserIdSchema>;
export const parseUserId = userId.parse;
export const isUserId = userId.is;
