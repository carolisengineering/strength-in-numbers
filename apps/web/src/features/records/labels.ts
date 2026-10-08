import { RECORD_TYPE_VALUES, type PersonalRecord, type RecordType, type UnitPreference } from "@sin/core";
import { formatRecordValue } from "../units/format";

export function recordLabel(type: RecordType): string {
  switch (type) {
    case "heaviest_weight":
      return "Heaviest weight";
    case "best_est_1rm":
      return "Best est. 1RM";
    case "best_set_volume":
      return "Best set volume";
    case "max_reps":
      return "Most reps";
    default: {
      const unreachable: never = type;
      throw new Error(`Unhandled record type: ${String(unreachable)}`);
    }
  }
}

/**
 * Name, then the record-type order — so the finish response and the GET (whose server orderings are
 * specified independently) render the same list (Spec 08.0 §6.5).
 */
export function sortRecords(records: readonly PersonalRecord[]): PersonalRecord[] {
  return [...records].sort(
    (a, b) =>
      a.exerciseName.localeCompare(b.exerciseName, "en") ||
      RECORD_TYPE_VALUES.indexOf(a.recordType) - RECORD_TYPE_VALUES.indexOf(b.recordType),
  );
}

/** `"Bench Press — Heaviest weight 102.5 kg (was 100 kg)"` (Spec 08.0 AC18). */
export function recordLine(record: PersonalRecord, pref: UnitPreference): string {
  const value = formatRecordValue(record.value, record.unit, pref);
  const was =
    record.previousValue === null ? " (first record)" : ` (was ${formatRecordValue(record.previousValue, record.unit, pref)})`;
  return `${record.exerciseName} — ${recordLabel(record.recordType)} ${value}${was}`;
}
