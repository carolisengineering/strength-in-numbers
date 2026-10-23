/**
 * Spec 09.2 §5 — pure section rules shared by the API (RoutineWriteSchema) and the 10.3 editor.
 * No I/O, no DOM, no Node APIs, no imports (purity check).
 */

/**
 * `refs[i]` is the index into the declared section list of item i's section, or null for a loose item.
 * Returns the indexes of items that break "loose first, then sections in declared order, each a
 * contiguous run": a loose item after any sectioned one, or an item whose section index is lower than
 * an earlier item's. Equivalent to: rank (-1 for loose) must never drop below the running maximum.
 */
export function sectionOrderViolations(refs: readonly (number | null)[]): number[] {
  const out: number[] = [];
  let max = -1;
  refs.forEach((ref, i) => {
    const rank = ref === null ? -1 : ref;
    if (rank < max) out.push(i);
    else max = rank;
  });
  return out;
}

/**
 * `groups[i]` is item i's supersetGroup label; `refs[i]` as above. For every label the first member
 * fixes the section; returns, ascending, the indexes of later members whose ref differs (loose is its
 * own "section").
 */
export function sectionSpanViolations(
  groups: readonly (number | null)[],
  refs: readonly (number | null)[],
): number[] {
  const firstRef = new Map<number, number | null>();
  const out: number[] = [];
  groups.forEach((group, i) => {
    if (group === null) return;
    const ref = refs[i] ?? null;
    if (!firstRef.has(group)) firstRef.set(group, ref);
    else if (firstRef.get(group) !== ref) out.push(i);
  });
  return out;
}

/**
 * Maximal runs of consecutive items with the same section id, in order (null = loose). Display
 * grouping for the editor, the preview and the session — never throws on a non-contiguous input;
 * it just yields more runs.
 */
export function groupBySection<T>(
  items: readonly T[],
  sectionOf: (item: T) => string | null,
): { sectionId: string | null; items: T[] }[] {
  const runs: { sectionId: string | null; items: T[] }[] = [];
  for (const item of items) {
    const sectionId = sectionOf(item);
    const last = runs[runs.length - 1];
    if (last && last.sectionId === sectionId) last.items.push(item);
    else runs.push({ sectionId, items: [item] });
  }
  return runs;
}

/**
 * Spec 09.4 §6.5 — the section a plain "Add exercise" (no position) joins: the last section (highest
 * position) iff it was added during the workout, else null. The input order is not assumed.
 */
export function sectionForNewExercise<S extends { position: number; addedInWorkout: boolean }>(
  sections: readonly S[],
): S | null {
  let last: S | null = null;
  for (const section of sections) if (last === null || section.position > last.position) last = section;
  return last !== null && last.addedInWorkout ? last : null;
}

/**
 * Spec 09.4 §6.2 — the final index for an exercise of `rank` (-1 = loose, otherwise its section's
 * position) among `ranks`, the OTHER exercises' ranks in position order: after the last other whose
 * rank is >= 0 and <= `rank`; else at the first other with rank >= 0; else at the end. Loose
 * exercises never anchor, so an exercise lands before a loose tail.
 */
export function insertIndexForSection(ranks: readonly number[], rank: number): number {
  let after = -1;
  ranks.forEach((r, i) => {
    if (r >= 0 && r <= rank) after = i;
  });
  if (after >= 0) return after + 1;
  const first = ranks.findIndex((r) => r >= 0);
  return first >= 0 ? first : ranks.length;
}
