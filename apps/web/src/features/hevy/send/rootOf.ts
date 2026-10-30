import { lineageRootId } from "@sin/core";

/**
 * The one lineage-root lookup for "is every exercise matched" (`buildHevyWorkout`'s `rootOf`): the send, auto-push's
 * check and the needs-matching line all build it here, so they always agree. An exercise not in the rows is its own root.
 */
export function rootOfRows(rows: readonly Parameters<typeof lineageRootId>[0][]): (exerciseId: string) => string {
  const roots = new Map<string, string>(rows.map((row) => [row.id, lineageRootId(row)]));
  return (id) => roots.get(id) ?? id;
}
