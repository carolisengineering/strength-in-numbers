import { RECORD_TYPE_VALUES, type PersonalRecord, type RecordType, type UnitPreference, type WorkoutDetail } from "@sin/core";

import { formatE1rmGain, formatRecordByType, formatRecordValue } from "../units/format";
import { formatSet } from "../workouts/format";
import { recordLabel, shortRecordLabel, sortRecords } from "./labels";

/**
 * Spec 17.2 §6.3: the pure pipeline behind the summary's record cards. Rendering is dumb; every decision (what is hidden,
 * what leads, what the gain says, what order) is here and table-tested. No PR math: this only formats what 07.0 stored.
 */
export interface RecordCardModel {
  /** The lineage root. */
  readonly key: string;
  readonly name: string;
  /** The lead set as logged ("190 kg × 5"), or `null` when that set is not in the workout. */
  readonly setText: string | null;
  readonly lead: {
    readonly label: string;
    readonly valueText: string;
    readonly gainText: string | null;
    readonly wasText: string | null;
    readonly first: boolean;
  };
  readonly chips: readonly { readonly type: RecordType; readonly label: string }[];
}

/** AC16: set-volume records are not shown on the summary (they stay in the cache and in Progress). */
export function visibleRecords(records: readonly PersonalRecord[]): PersonalRecord[] {
  return records.filter((r) => r.recordType !== "best_set_volume");
}

/** AC26: the "N new" figure: every visible record, cards plus chips. */
export function recordsNewCount(records: readonly PersonalRecord[]): number {
  return visibleRecords(records).length;
}

const LEAD_ORDER: readonly RecordType[] = RECORD_TYPE_VALUES.filter((t) => t !== "best_set_volume");

/** The gain line for a record, or `null` for a first record or a rounded e1RM that did not rise (AC19, AC22). */
function gainTextOf(r: PersonalRecord, pref: UnitPreference): string | null {
  if (r.previousValue === null) return null;
  if (r.recordType === "best_est_1rm") return formatE1rmGain(r.value, r.previousValue, pref);
  return `+${formatRecordValue(r.value - r.previousValue, r.unit, pref)}`;
}

export function buildRecordCards({ records, workout, pref }: { records: readonly PersonalRecord[]; workout: Pick<WorkoutDetail, "exercises">; pref: UnitPreference }): RecordCardModel[] {
  const groups = new Map<string, PersonalRecord[]>();
  for (const r of sortRecords(visibleRecords(records))) {
    const list = groups.get(r.exerciseId);
    if (list) list.push(r);
    else groups.set(r.exerciseId, [r]);
  }
  const position = new Map(workout.exercises.map((e) => [e.exerciseId, e.position]));
  const sets = new Map(workout.exercises.flatMap((e) => e.sets.map((s) => [s.id, { set: s, modality: e.modalitySnapshot }] as const)));

  const built = [...groups.entries()].map(([key, group]) => {
    const ordered = [...group].sort((a, b) => LEAD_ORDER.indexOf(a.recordType) - LEAD_ORDER.indexOf(b.recordType));
    // D16: an est. 1RM whose rounded gain is not a rise cannot lead while anything else can.
    const canLead = (r: PersonalRecord) => r.previousValue === null || gainTextOf(r, pref) !== null;
    const lead = ordered.find(canLead) ?? ordered[0]!;
    const demoted = lead.recordType === "best_est_1rm" && !canLead(lead);
    const gainText = demoted ? null : gainTextOf(lead, pref);
    const found = sets.get(lead.sourceSetId);
    const slots = group.map((r) => position.get(r.sourceExerciseId)).filter((n): n is number => n !== undefined);
    return {
      order: slots.length > 0 ? Math.min(...slots) : Number.POSITIVE_INFINITY,
      card: {
        key,
        name: lead.exerciseName,
        setText: found ? formatSet(found.set, found.modality) : null,
        lead: {
          label: recordLabel(lead.recordType),
          valueText: formatRecordByType(lead.recordType, lead.value, lead.unit, pref),
          gainText,
          wasText: gainText === null || lead.previousValue === null ? null : `was ${formatRecordByType(lead.recordType, lead.previousValue, lead.unit, pref)}`,
          first: lead.previousValue === null,
        },
        chips: ordered.filter((r) => r !== lead).map((r) => ({ type: r.recordType, label: shortRecordLabel(r.recordType) })),
      } satisfies RecordCardModel,
    };
  });
  // AC25: the workout's exercise order; a card whose exercise cannot be matched goes after, in name order.
  return built.sort((a, b) => (a.order === b.order ? a.card.name.localeCompare(b.card.name, "en") : a.order - b.order)).map((b) => b.card);
}
