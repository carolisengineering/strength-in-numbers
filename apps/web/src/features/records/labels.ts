import { RECORD_TYPE_VALUES, type PersonalRecord, type RecordType, type UnitPreference } from "@sin/core";
import { formatRecordByType, formatWeightKgPrecise } from "../units/format";

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
    case "max_reps_at_weight":
      // Spec 07.5 R3: the type alone, for places with no record in hand; a row names its weight (`recordRowLabel`).
      return "Most reps at a weight";
    default: {
      const unreachable: never = type;
      throw new Error(`Unhandled record type: ${String(unreachable)}`);
    }
  }
}

/**
 * One lineage's records (one exercise's, never several exercises' at once) in the record-type order, then the heavier weight first (Spec 07.5 AC36, AC39; the API's AC26
 * order), whatever order the server sent. No name key: a lineage's records carry each source workout's name snapshot,
 * which differs after a rename or under a copy, and must not split one exercise's list (final review, Spec 07.5 C).
 */
export function sortRecords(records: readonly PersonalRecord[]): PersonalRecord[] {
  return [...records].sort(
    (a, b) => RECORD_TYPE_VALUES.indexOf(a.recordType) - RECORD_TYPE_VALUES.indexOf(b.recordType) || (b.atWeightKg ?? 0) - (a.atWeightKg ?? 0),
  );
}

/**
 * A record row's label (Spec 07.5): "Most reps at 32.5 kg" for a most-reps-at-a-weight record, in the profile unit
 * with the records' own rounding; every other type's label is `recordLabel`.
 */
export function recordRowLabel(record: PersonalRecord, pref: UnitPreference): string {
  if (record.recordType === "max_reps_at_weight" && record.atWeightKg !== null) {
    // The weight reads exactly as a heaviest-weight record of that weight would (17.2 AC29: one type-aware formatter).
    return repsAtLabel(formatRecordByType("heaviest_weight", record.atWeightKg, "kg", pref));
  }
  return recordLabel(record.recordType);
}

/** A no-break space keeps "32.5 kg" whole, so the ledger's fixed label column breaks before the weight (07.5 AC38). */
const repsAtLabel = (weight: string) => `Most reps at ${weight.replace(" ", "\u00a0")}`;

/**
 * The labels of records drawn together (one lift's rows), keyed by record. Spec 07.5 D12 (owner, 2026-11-20, minor 684):
 * weights are stored to the gram, so in a lb account two can read alike ("45 lb" for 20.4 kg and for 20.412 kg); only
 * those rows take the weight to 0.01 lb ("44.97 lb", "45 lb"). Every other label is `recordRowLabel`'s.
 */
export function recordRowLabels(records: readonly PersonalRecord[], pref: UnitPreference): Map<PersonalRecord, string> {
  const labels = new Map(records.map((r) => [r, recordRowLabel(r, pref)] as const));
  const seen = new Map<string, number>();
  for (const label of labels.values()) seen.set(label, (seen.get(label) ?? 0) + 1);
  for (const r of records) {
    if (r.recordType === "max_reps_at_weight" && r.atWeightKg !== null && (seen.get(labels.get(r)!) ?? 0) > 1) {
      labels.set(r, repsAtLabel(formatWeightKgPrecise(r.atWeightKg, pref)));
    }
  }
  return labels;
}

/** What a row says when the record has no previous value (Spec 17.11 AC7). */
export const FIRST_RECORD = "First record";

export interface RecordParts {
  readonly label: string;
  readonly value: string;
  /** The previous value, formatted ("80 kg"); `null` for a first record, or when it reads the same as `value` (minor 511). */
  readonly was: string | null;
  /** True only when there was no previous value (the row says "First record"). */
  readonly first: boolean;
}

/**
 * The one source of a record's text on the exercise page (Spec 17.11 §6.2): `RecordRows` draws these parts as a
 * name-free row, "Heaviest weight 82.5 kg was 80 kg". Replaces 08.0's name-prefixed `recordLine`.
 */
export function recordParts(record: PersonalRecord, pref: UnitPreference, label: string = recordRowLabel(record, pref)): RecordParts {
  const value = formatRecordByType(record.recordType, record.value, record.unit, pref);
  const was = record.previousValue === null ? null : formatRecordByType(record.recordType, record.previousValue, record.unit, pref);
  // Minor 511: two values that round to one figure read as the value alone, as `formatRecordPair` shows them.
  return { label, value, was: was === value ? null : was, first: record.previousValue === null };
}
