import { SUPERSET_GROUP_MEMBERS_MAX } from "@sin/core";

/**
 * Spec 10.7 AC23 — the "Only the first 8 exercises are grouped." line shows when the first 8
 * share one group and the next one is loose, which is exactly what the cap leaves behind.
 */
export function capLineShown(groups: readonly (number | null)[]): boolean {
  if (groups.length <= SUPERSET_GROUP_MEMBERS_MAX) return false;
  const first = groups[0];
  if (first === null || first === undefined) return false;
  const head = groups.slice(0, SUPERSET_GROUP_MEMBERS_MAX);
  return head.every((g) => g === first) && groups[SUPERSET_GROUP_MEMBERS_MAX] === null;
}
