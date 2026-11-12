import { RECORD_TYPE_VALUES, type PersonalRecord, type RecordType, type UnitPreference } from "@sin/core";
import { formatRecordByType } from "../units/format";

export function recordLabel(type: RecordType): string {
  switch (type) {
    case "heaviest_weight":
      return "Heaviest weight";
    case "best_est_1rm":
      return "Est. 1-rep max";
    case "best_set_volume":
      return "Best set volume";
    case "max_reps":
      return "Most reps";
    case "max_calories":
      return "Most calories";
    case "max_distance":
      return "Longest distance";
    case "max_duration":
      return "Longest hold";
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

/** What a row says when the record has no previous value (Spec 17.11 AC7). */
export const FIRST_RECORD = "First record";

export interface RecordParts {
  readonly label: string;
  readonly value: string;
  /** The previous value, formatted ("80 kg"), or `null` for a first record. */
  readonly was: string | null;
}

/**
 * The one source of a record's text on the exercise page (Spec 17.11 §6.2): `RecordRows` draws these parts as a
 * name-free row, "Heaviest weight 82.5 kg was 80 kg". Replaces 08.0's name-prefixed `recordLine`.
 */
export function recordParts(record: PersonalRecord, pref: UnitPreference): RecordParts {
  return {
    label: recordLabel(record.recordType),
    value: formatRecordByType(record.recordType, record.value, record.unit, pref),
    was: record.previousValue === null ? null : formatRecordByType(record.recordType, record.previousValue, record.unit, pref),
  };
}
