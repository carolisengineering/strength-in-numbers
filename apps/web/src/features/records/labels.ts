import { RECORD_TYPE_VALUES, type PersonalRecord, type RecordType, type UnitPreference } from "@sin/core";
import { formatRecordByType } from "../units/format";

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

/** Chip names on a record card (Spec 17.2 AC20): short, because a chip carries a name and nothing else. */
export function shortRecordLabel(type: RecordType): string {
  switch (type) {
    case "heaviest_weight":
      return "Heaviest";
    case "best_est_1rm":
      return "Est. 1RM";
    case "best_set_volume":
      return "Set volume";
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
  const value = formatRecordByType(record.recordType, record.value, record.unit, pref);
  const was =
    record.previousValue === null ? " (first record)" : ` (was ${formatRecordByType(record.recordType, record.previousValue, record.unit, pref)})`;
  return `${record.exerciseName} — ${recordLabel(record.recordType)} ${value}${was}`;
}
