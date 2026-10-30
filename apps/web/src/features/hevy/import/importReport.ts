import { localDateFor, offsetMinutesForZone, type CodeCount, type HevyImportResult, type HevyWorkout } from "@sin/core";

import { saveBlob } from "../../account/saveBlob";
import type { RoutineOutcome } from "./createRoutines";
import { displayTitle } from "./importSummary";
import { UNREADABLE_LABEL } from "./messages";

/**
 * Spec 20.1 AC26, D8: the import report, a CSV built on the device from the session (titles stay on the device; the
 * key is never in the session's results). One row per workout that wasn't simply created, one per routine outcome.
 * Pure but for `downloadReport`.
 */

export const REPORT_FILENAME = "hevy-import-report.csv";
const HEADER = ["kind", "date", "title", "outcome", "detail"] as const;
/** O2 / D18: a sendable workout the run never sent because of a Stop. */
export const NOT_SENT_OUTCOME = "not_imported_stopped";

/**
 * RFC 4180: a field holding a comma, a quote, a CR or an LF is quoted, its quotes doubled. A field a spreadsheet
 * would read as a formula (a leading `=`, `+`, `-`, `@`, tab or CR, or a `'` that would hide) gets a `'` first, the
 * same set as 19.0's mapping CSV (minor 189).
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r']/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const codes = (list: readonly CodeCount<string>[]) => list.map((c) => `${c.code}×${c.count}`).join("; ");

export interface ImportReportInput {
  /** `finalResults(...).results`: the run's own results where a workout was sent. */
  results: readonly HevyImportResult[];
  /** `finalResults(...).notSent`. */
  notSent: readonly string[];
  workouts: ReadonlyMap<string, HevyWorkout>;
  unreadable: readonly string[];
  routines: readonly RoutineOutcome[];
  zone: string;
}

export function buildImportReport(input: ImportReportInput): string {
  const dateOf = (id: string): string => {
    const w = input.workouts.get(id);
    if (w === undefined) return "";
    try {
      return localDateFor(w.start_time, offsetMinutesForZone(w.start_time, input.zone));
    } catch {
      return "";
    }
  };
  const titleOf = (id: string) => displayTitle(input.workouts.get(id)?.title);
  const lines: string[][] = [[...HEADER]];
  for (const r of input.results) {
    if (r.outcome === "create" && r.drops.length === 0 && r.notices.length === 0) continue;
    lines.push(["workout", dateOf(r.hevyWorkoutId), titleOf(r.hevyWorkoutId), r.outcome, codes([...r.drops, ...r.notices])]);
  }
  for (const id of input.notSent) lines.push(["workout", dateOf(id), titleOf(id), NOT_SENT_OUTCOME, ""]);
  for (const id of input.unreadable) lines.push(["workout", dateOf(id), titleOf(id), "unreadable", UNREADABLE_LABEL]);
  for (const r of input.routines) lines.push(["routine", "", r.name, r.kind, codes(r.notices)]);
  return lines.map((cells) => `${cells.map(csvField).join(",")}\r\n`).join("");
}

/** AC26: hands the CSV to the browser as `hevy-import-report.csv` (UTF-8, no BOM). */
export function downloadReport(csv: string, save: (blob: Blob, filename: string) => void = saveBlob): void {
  save(new Blob([csv], { type: "text/csv;charset=utf-8" }), REPORT_FILENAME);
}
