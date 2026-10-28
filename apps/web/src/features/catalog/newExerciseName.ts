import { CatalogName, EXERCISE_NAME_MAX, normalizeExerciseName } from "@sin/core";

/**
 * The name checks for an exercise about to be created from a card: the routine import (Spec 10.4) and the Hevy
 * pairing cards (Spec 20.0 D8). They live here, in neither feature, so neither imports the other.
 */

export const NEW_NAME_REQUIRED = "Give the exercise a name";
export const NEW_NAME_TOO_LONG = "Keep the name to 120 characters or fewer";
export const NEW_NAME_INVALID = "Remove unusual characters from the name";

/** What is wrong with a new exercise's name, or `null`. */
export function newNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return NEW_NAME_REQUIRED;
  if (trimmed.length > EXERCISE_NAME_MAX) return NEW_NAME_TOO_LONG;
  return CatalogName.safeParse(trimmed).success ? null : NEW_NAME_INVALID;
}

/** The indexes whose name, normalized, appears more than once; an empty key (no letter or digit) never counts. */
export function duplicateNewNameKeys(names: readonly string[]): ReadonlySet<number> {
  const keys = names.map((name) => normalizeExerciseName(name));
  const seen = new Map<string, number>();
  for (const key of keys) if (key !== "") seen.set(key, (seen.get(key) ?? 0) + 1);
  const out = new Set<number>();
  keys.forEach((key, i) => {
    if (key !== "" && (seen.get(key) ?? 0) > 1) out.add(i);
  });
  return out;
}
