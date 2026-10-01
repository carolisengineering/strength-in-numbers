import type { Exercise } from "@sin/core";

/**
 * Pure picker-visibility rules (Spec 06.0 §6.4). No React, no DOM — a Spec 16
 * candidate for promotion into `@sin/core`.
 */

/**
 * The rows a picker may show (AC4, AC5): active rows, minus any row that an
 * active row was forked from. This must see the **whole** row set — whether a
 * row is a fork origin depends on every other row — so never call it on a
 * subset such as the recents.
 */
export function visibleRows(rows: readonly Exercise[]): Exercise[] {
  const active = rows.filter((row) => row.isActive);
  const forkedOrigins = new Set<string>();
  for (const row of active) {
    if (row.forkedFromExerciseId !== null) forkedOrigins.add(row.forkedFromExerciseId);
  }
  return active.filter((row) => !forkedOrigins.has(row.id));
}

// Pinned to "en" so the order never depends on the device or CI locale (AC6).
const collator = new Intl.Collator("en", { sensitivity: "base" });

export function sortByName(rows: readonly Exercise[]): Exercise[] {
  return [...rows].sort((a, b) => collator.compare(a.name, b.name));
}

/** Strip diacritics and case so "Café" and "cafe" compare equal (AC7). */
export const fold = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function searchByName(rows: readonly Exercise[], query: string): Exercise[] {
  const needle = fold(query.trim());
  if (needle === "") return [...rows];
  return rows.filter((row) => fold(row.name).includes(needle));
}

export interface AttributeFilters {
  muscleId: string | null;
  equipmentId: string | null;
}

export function filterByAttributes(
  rows: readonly Exercise[],
  { muscleId, equipmentId }: AttributeFilters,
): Exercise[] {
  return rows.filter(
    (row) =>
      (muscleId === null ||
        row.primaryMuscleId === muscleId ||
        row.secondaryMuscleIds.includes(muscleId)) &&
      (equipmentId === null || row.equipmentId === equipmentId),
  );
}

/**
 * The recent rows, most-recent-first (AC21): a lookup into the already-visible
 * set that preserves `recentIds` order. An id that is retired, hidden, or
 * unknown simply drops out.
 */
export function pickRecents(
  visible: readonly Exercise[],
  recentIds: readonly string[],
): Exercise[] {
  const byId = new Map<string, Exercise>(visible.map((row) => [row.id, row]));
  return recentIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}
