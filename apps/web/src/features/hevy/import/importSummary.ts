import {
  HEVY_IMPORT_DROP_CODES,
  localDateFor,
  offsetMinutesForZone,
  type HevyImportDropCode,
  type HevyImportResult,
  type HevyWorkout,
} from "@sin/core";

import { DROP_LABELS, importLabel, NOTHING_NEW, OUTCOME_LABELS, UNREADABLE_LABEL, UNTITLED } from "./messages";

/** Spec 20.1 AC12, AC13, §6.6: the summary, folded from the dry-run results. Pure. */

export interface Aggregate {
  read: number;
  create: number;
  /** `already_imported` + `already_matched`. */
  alreadyInSin: number;
  sentFromSin: number;
  duplicate: number;
  deletedInSin: number;
  /** `no_usable_sets` + `time_invalid` + `rejected` + the unreadable ones (AC6). */
  cannotImport: number;
  unpaired: number;
  /** The sets of the workouts that will be written (`create` and `duplicate`). */
  setsKept: number;
  /** Every drop code except `exercise_no_sets`, which counts exercises whose sets are already counted (minor 149). */
  setsDropped: number;
  drops: Record<HevyImportDropCode, number>;
  unpairedTemplates: string[];
}

export function aggregateResults(results: readonly HevyImportResult[], unreadable: readonly string[]): Aggregate {
  const drops = Object.fromEntries(HEVY_IMPORT_DROP_CODES.map((c) => [c, 0])) as Record<HevyImportDropCode, number>;
  const agg: Aggregate = {
    read: results.length + unreadable.length,
    create: 0,
    alreadyInSin: 0,
    sentFromSin: 0,
    duplicate: 0,
    deletedInSin: 0,
    cannotImport: unreadable.length,
    unpaired: 0,
    setsKept: 0,
    setsDropped: 0,
    drops,
    unpairedTemplates: [],
  };
  const unpaired = new Set<string>();
  for (const r of results) {
    switch (r.outcome) {
      case "create":
        agg.create += 1;
        break;
      case "already_imported":
      case "already_matched":
        agg.alreadyInSin += 1;
        break;
      case "sent_from_sin":
        agg.sentFromSin += 1;
        break;
      case "duplicate":
        agg.duplicate += 1;
        break;
      case "deleted_in_sin":
        agg.deletedInSin += 1;
        break;
      case "no_usable_sets":
      case "time_invalid":
      case "rejected":
        agg.cannotImport += 1;
        break;
      case "unpaired":
        agg.unpaired += 1;
        break;
    }
    if (r.outcome === "create" || r.outcome === "duplicate") agg.setsKept += r.setCount;
    for (const d of r.drops) {
      drops[d.code] += d.count;
      if (d.code !== "exercise_no_sets") agg.setsDropped += d.count;
    }
    for (const id of r.unpaired) unpaired.add(id);
  }
  agg.unpairedTemplates = [...unpaired];
  return agg;
}

export type ListGroup = "duplicate" | "cannot_import" | "sets_dropped" | "unpaired";
export interface ListRow {
  id: string;
  date: string;
  title: string;
  reason: string;
}

const GROUP_ORDER: readonly ListGroup[] = ["duplicate", "cannot_import", "sets_dropped", "unpaired"];

/** A blank or whitespace-only title reads "Untitled" (AC12); any other title is shown as written, as text. */
export const displayTitle = (title: string | null | undefined): string => (title == null || title.trim() === "" ? UNTITLED : title);

const dropReason = (r: HevyImportResult) => r.drops.map((d) => `${DROP_LABELS[d.code]} (${d.count})`).join("; ");

/**
 * AC12's lists: every duplicate, every workout that can't be imported (unreadable ones included) and every workout
 * that will be written with sets dropped, plus those waiting for a pairing. Rows are `{local date, title, reason}`,
 * the date in the device zone, sorted newest first, then by title. Empty groups are left out.
 */
export function summaryLists(
  results: readonly HevyImportResult[],
  workouts: ReadonlyMap<string, HevyWorkout>,
  unreadable: readonly string[],
  zone: string,
): { group: ListGroup; rows: ListRow[] }[] {
  const rows = new Map<ListGroup, ListRow[]>(GROUP_ORDER.map((g) => [g, []]));
  const row = (id: string, reason: string): ListRow => {
    const w = workouts.get(id);
    let date = "";
    if (w) {
      try {
        date = localDateFor(w.start_time, offsetMinutesForZone(w.start_time, zone));
      } catch {
        date = "";
      }
    }
    return { id, date, title: displayTitle(w?.title), reason };
  };
  for (const id of unreadable) rows.get("cannot_import")!.push(row(id, UNREADABLE_LABEL));
  for (const r of results) {
    if (r.outcome === "duplicate") rows.get("duplicate")!.push(row(r.hevyWorkoutId, OUTCOME_LABELS.duplicate));
    else if (r.outcome === "no_usable_sets" || r.outcome === "time_invalid" || r.outcome === "rejected")
      rows.get("cannot_import")!.push(row(r.hevyWorkoutId, OUTCOME_LABELS[r.outcome]));
    else if (r.outcome === "unpaired") rows.get("unpaired")!.push(row(r.hevyWorkoutId, OUTCOME_LABELS.unpaired));
    if ((r.outcome === "create" || r.outcome === "duplicate") && r.drops.length > 0) rows.get("sets_dropped")!.push(row(r.hevyWorkoutId, dropReason(r)));
  }
  const byDate = (a: ListRow, b: ListRow) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return GROUP_ORDER.flatMap((group) => {
    const list = rows.get(group)!;
    return list.length > 0 ? [{ group, rows: list.sort(byDate) }] : [];
  });
}

/** AC16 (used by Phase B): the Hevy ids the run sends — a `create`, and a `duplicate` so its link is written. */
export function sendable(results: readonly HevyImportResult[]): string[] {
  return results.filter((r) => r.outcome === "create" || r.outcome === "duplicate").map((r) => r.hevyWorkoutId);
}

/**
 * AC17, AC25, §6.6: the dry run's results with each sent workout's replaced by the run's own (the truth: a sent
 * `duplicate` may come back `create`, a `create` may come back `already_imported`). A sendable workout the run never
 * sent (a Stop, or not yet) is left out of `results` and listed in `notSent` (O2 / D18: "Not imported (stopped)").
 */
export function finalResults(dryRun: readonly HevyImportResult[], run: readonly HevyImportResult[]): { results: HevyImportResult[]; notSent: string[] } {
  const real = new Map(run.map((r) => [r.hevyWorkoutId, r]));
  const results: HevyImportResult[] = [];
  const notSent: string[] = [];
  for (const r of dryRun) {
    const sent = real.get(r.hevyWorkoutId);
    if (sent !== undefined) results.push(sent);
    else if (r.outcome === "create" || r.outcome === "duplicate") notSent.push(r.hevyWorkoutId);
    else results.push(r);
  }
  return { results, notSent };
}

/**
 * AC14: the primary button's words, or "Nothing new to import" when there is no workout and no routine. Workouts
 * waiting for a pairing (AC13) are never "nothing new": they are still to import once paired.
 */
export function confirmLabel(agg: Aggregate, routineCount: number, sendCount: number): string {
  if (sendCount === 0 && routineCount === 0 && agg.unpaired === 0) return NOTHING_NEW;
  return importLabel(agg.create, routineCount);
}
