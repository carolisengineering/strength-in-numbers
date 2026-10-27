import { lineageRootId, type Exercise } from "@sin/core";

import { MODALITY_LABELS } from "../catalog/labels";
import { nameCollator } from "../catalog/visibility";
import { formatLocalDateWithYear } from "../progress/dates";
import { formatLocalDate } from "../workouts/format";
import { EXERCISES_COPY } from "./messages";

export type ExerciseSource = "builtin" | "yours";

export interface ExerciseRow {
  row: Exercise;
  lastLoggedOn: string | null;
  source: ExerciseSource;
}

const byId = (a: ExerciseRow, b: ExerciseRow): number =>
  a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;

const byName = (a: ExerciseRow, b: ExerciseRow): number =>
  nameCollator.compare(a.row.name, b.row.name) || byId(a, b);

/**
 * All exercises, in list order (Spec 18.2 AC8, AC9): logged rows by last-logged date (newest first),
 * then never-logged rows; name then id break ties. A row's date is its lineage root's, so a fork shows
 * its built-in's history. `visible` is `visibleRows(...)`, so a hidden origin never appears.
 */
export function buildExerciseRows(
  visible: readonly Exercise[],
  usage: ReadonlyMap<string, string>,
): ExerciseRow[] {
  const rows: ExerciseRow[] = visible.map((row) => ({
    row,
    lastLoggedOn: usage.get(lineageRootId(row)) ?? null,
    source: row.ownerUserId === null ? "builtin" : "yours",
  }));
  const logged = rows.filter((r) => r.lastLoggedOn !== null);
  const unlogged = rows.filter((r) => r.lastLoggedOn === null);
  logged.sort((a, b) => {
    const left = a.lastLoggedOn ?? "";
    const right = b.lastLoggedOn ?? "";
    return left > right ? -1 : left < right ? 1 : byName(a, b);
  });
  unlogged.sort(byName);
  return [...logged, ...unlogged];
}

/**
 * A row's second line (AC10): "Last logged Sat 24 Oct · Calories", the year added outside today's
 * year; "Built in" / "Yours" when never logged; only the type while usage is unknown (AC14 c).
 */
export function metaLine(item: ExerciseRow, today: string, usageKnown: boolean): string {
  const type = MODALITY_LABELS[item.row.modality];
  if (!usageKnown) return type;
  const date = item.lastLoggedOn;
  const lead =
    date === null
      ? item.source === "builtin"
        ? EXERCISES_COPY.builtIn
        : EXERCISES_COPY.yours
      : EXERCISES_COPY.lastLogged(
          date.slice(0, 4) === today.slice(0, 4) ? formatLocalDate(date) : formatLocalDateWithYear(date),
        );
  return `${lead} · ${type}`;
}
