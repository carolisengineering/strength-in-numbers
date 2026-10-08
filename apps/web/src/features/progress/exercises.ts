import type { PersonalRecord, RecordType, UnitPreference } from "@sin/core";
import { recordLabel } from "../records/labels";
import { formatRecordValue } from "../units/format";
import { formatLocalDate } from "../workouts/format";

/** One Progress list row (Spec 08.1 AC6, D6). */
export interface ExerciseEntry {
  exerciseId: string;
  name: string;
  newest: PersonalRecord;
  headline: PersonalRecord | null;
}

/** `best_set_volume` is never the headline: it is a single set, the chart's volume a session sum (07.2 D12). */
const HEADLINE: readonly RecordType[] = ["best_est_1rm", "heaviest_weight", "max_reps"];

const at = (r: PersonalRecord) => Date.parse(r.achievedAt);

export function groupByExercise(records: readonly PersonalRecord[]): ExerciseEntry[] {
  const byRoot = new Map<string, PersonalRecord[]>();
  for (const r of records) byRoot.set(r.exerciseId, [...(byRoot.get(r.exerciseId) ?? []), r]);
  const entries = [...byRoot.entries()].map(([exerciseId, rs]) => {
    const newest = rs.reduce((a, b) => (at(b) > at(a) ? b : a));
    const headline = HEADLINE.map((t) => rs.find((r) => r.recordType === t)).find((r) => r !== undefined) ?? null;
    return { exerciseId, name: newest.exerciseName, newest, headline };
  });
  return entries.sort(
    (a, b) => at(b.newest) - at(a.newest) || a.name.localeCompare(b.name, "en") || a.exerciseId.localeCompare(b.exerciseId),
  );
}

/** `"Best est. 1RM 122.5 kg · Tue 6 Oct"`, or the date alone when there is no headline type (AC11). */
export function headlineText(entry: ExerciseEntry, pref: UnitPreference): string {
  const date = formatLocalDate(entry.newest.localDate);
  const h = entry.headline;
  return h ? `${recordLabel(h.recordType)} ${formatRecordValue(h.value, h.unit, pref)} · ${date}` : date;
}
