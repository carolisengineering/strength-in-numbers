/** One side of the duplicate test: a Hevy workout's translation or a SIN workout, with lineage roots. */
export interface DuplicateSide {
  localDate: string;
  startedAt: string;
  title: string | null;
  rootIds: readonly string[];
}

const HOUR_MS = 3_600_000;

/** A title's match key: trimmed, inner whitespace runs collapsed to one space, lowercased; blank is `null`. */
export function titleKey(t: string | null): string | null {
  if (t === null) return null;
  const key = t.trim().replace(/\s+/g, " ").toLowerCase();
  return key === "" ? null : key;
}

/**
 * Spec 19.1 AC10, D5: the same session iff the same local day, starts at most an hour apart (inclusive), and names
 * match. Two titles match only when equal by `titleKey`; when either is untitled, more than half of the larger set of
 * lineage roots must be shared (neither empty).
 */
export function isDuplicateWorkout(h: DuplicateSide, s: DuplicateSide): boolean {
  if (h.localDate !== s.localDate) return false;
  if (Math.abs(Date.parse(h.startedAt) - Date.parse(s.startedAt)) > HOUR_MS) return false;
  const a = titleKey(h.title);
  const b = titleKey(s.title);
  if (a !== null && b !== null) return a === b;
  const A = new Set(h.rootIds);
  const B = new Set(s.rootIds);
  if (A.size === 0 || B.size === 0) return false;
  let shared = 0;
  for (const root of A) if (B.has(root)) shared += 1;
  return 2 * shared > Math.max(A.size, B.size);
}
