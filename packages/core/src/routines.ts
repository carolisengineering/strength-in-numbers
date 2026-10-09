/**
 * Spec 09 §5 — pure routine helpers. No I/O, no DOM, no Node APIs (purity check).
 */

/** Renumbers superset groups 1, 2, 3 … by first appearance in item order
 * (Spec 09 D9). `null` stays `null`. Clients may send any labels (7, 3, 7, 3);
 * the server stores and returns the dense form (1, 2, 1, 2) and the editor
 * previews the same renumbering with this function. */
export function normalizeSupersetGroups(groups: readonly (number | null)[]): (number | null)[] {
  const byLabel = new Map<number, number>();
  return groups.map((g) => {
    if (g === null) return null;
    let dense = byLabel.get(g);
    if (dense === undefined) {
      dense = byLabel.size + 1;
      byLabel.set(g, dense);
    }
    return dense;
  });
}

/** `targetRpe` travels as a decimal (8.5) and is stored as tenths (85) —
 * Spec 09 D5. These two functions are the only conversion site. */
export function rpeToTenths(x: number): number {
  return Math.round(x * 10);
}

export function tenthsToRpe(n: number): number {
  return n / 10;
}
