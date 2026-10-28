import type { Exercise, HevyMapping, HevyPair } from "@sin/core";

import { nameCollator } from "../../catalog/visibility";

/** Spec 20.0 AC24, pure: the Pairings screen's groups. */
export interface PairingGroups {
  /** By SIN exercise, A–Z by the picker's collator; each exercise's pairs in stored order. */
  exercises: { exercise: Exercise; pairs: HevyPair[] }[];
  /** Pairs whose SIN exercise was deleted (soft-deleted, or gone from the catalog); only Remove is offered. */
  deleted: { exerciseId: string; name: string | null; pairs: HevyPair[] }[];
  skipped: HevyPair[];
  placeholders: HevyPair[];
  /** Minor 179: active pairs whose exercise isn't in a catalog that has never synced; neither live nor deleted yet. */
  loading: HevyPair[];
}

export function groupPairings(mapping: HevyMapping, rows: readonly Exercise[], opts: { synced: boolean } = { synced: true }): PairingGroups {
  const byId = new Map<string, Exercise>(rows.map((row) => [row.id, row]));
  const live = new Map<string, { exercise: Exercise; pairs: HevyPair[] }>();
  const deleted = new Map<string, { exerciseId: string; name: string | null; pairs: HevyPair[] }>();
  const skipped: HevyPair[] = [];
  const placeholders: HevyPair[] = [];
  const loading: HevyPair[] = [];

  for (const pair of mapping.pairs) {
    if (pair.role === "skip") skipped.push(pair);
    else if (pair.role !== "exercise") placeholders.push(pair);
    else if (pair.exerciseId !== null) {
      const row = byId.get(pair.exerciseId);
      if (row !== undefined && row.isActive && pair.exerciseActive !== false) {
        const group = live.get(row.id) ?? { exercise: row, pairs: [] };
        group.pairs.push(pair);
        live.set(row.id, group);
      } else if (row === undefined && !opts.synced && pair.exerciseActive !== false) {
        loading.push(pair);
      } else {
        const group = deleted.get(pair.exerciseId) ?? { exerciseId: pair.exerciseId, name: row?.name ?? null, pairs: [] };
        group.pairs.push(pair);
        deleted.set(pair.exerciseId, group);
      }
    }
  }
  return {
    exercises: [...live.values()].sort((a, b) => nameCollator.compare(a.exercise.name, b.exercise.name) || a.exercise.id.localeCompare(b.exercise.id)),
    deleted: [...deleted.values()],
    skipped,
    placeholders,
    loading,
  };
}
