import { RECORD_TYPE_VALUES, type PersonalRecord, type RecordType, type UnitPreference, type WorkoutDetail } from "@sin/core";

import { formatRecordByType, formatRecordPair } from "../units/format";
import { formatSet } from "../workouts/format";
import { recordLabel } from "./labels";

/**
 * Spec 17.6 §6.1: the pure model behind the summary's record ledger. Every decision (what is shown, what leads, what
 * the heading counts, which "from your …" line goes where, the order) is made here and table-tested; the components only
 * render it. No PR math: this formats what 07.0 stored, and every figure goes through `formatRecordPair`.
 */
export type LedgerSection = "workouts" | "history";

export interface LedgerRow {
  readonly type: RecordType;
  readonly label: string;
  readonly oldText: string | null;
  readonly newText: string;
  readonly gainText: string | null;
  /** The row's one sentence for a screen reader: "Heaviest weight: was 80 kg, now 82.5 kg, up 2.5 kg" (AC17). */
  readonly spoken: string;
  /** "from your 82.5 kg × 5", only when the lift's rows came from different sets (AC8). */
  readonly sourceText: string | null;
}

export interface LedgerLift {
  /** The lineage root. */
  readonly key: string;
  readonly name: string;
  readonly rows: readonly LedgerRow[];
  /** One line after the rows when every row came from the same set and that set is in the workout (AC8). */
  readonly sourceText: string | null;
  readonly hasEstimate: boolean;
}

export interface FirstTimeLine {
  readonly key: string;
  readonly text: string;
}

export interface RecordLedger {
  /** Null when no lift beat anything: then there is no panel and no brass (AC13). */
  readonly heading: string | null;
  readonly lifts: readonly LedgerLift[];
  readonly firsts: readonly FirstTimeLine[];
}

/** AC11 (D4): more than 4 collapses to the first 3. */
export const LEDGER_COLLAPSE_OVER = 4;
export const LEDGER_COLLAPSED_SHOWS = 3;

/** AC9: the panel's one explanation of the term, shown when an est. 1-rep max row is rendered. */
export const EST_1RM_EXPLAINED = "Est. 1-rep max: what you could likely lift once, worked out from weight × reps.";

/** How many items a list shows (AC11, AC13). */
export function collapsedCount(total: number, expanded: boolean): number {
  return !expanded && total > LEDGER_COLLAPSE_OVER ? LEDGER_COLLAPSED_SHOWS : total;
}

/** 17.2 AC16: set-volume records are not shown on the summary (they stay in the cache and in Progress). */
export function visibleRecords(records: readonly PersonalRecord[]): PersonalRecord[] {
  return records.filter((r) => r.recordType !== "best_set_volume");
}

const typeOrder = (r: PersonalRecord) => RECORD_TYPE_VALUES.indexOf(r.recordType);

function headingOf(lifts: readonly LedgerLift[], section: LedgerSection): string | null {
  if (lifts.length === 0) return null;
  const oneRow = lifts.length === 1 && lifts[0]!.rows.length === 1;
  const count = `${lifts.length} ${lifts.length === 1 ? "lift" : "lifts"}`;
  // AC15 (D5): a workout opened from History did not just set its records; they are the ones it holds now.
  if (section === "history") return oneRow ? "Record from this workout" : `Records from this workout on ${count}`;
  return oneRow ? "New record" : `New records on ${count}`;
}

export function buildRecordLedger({ records, workout, pref, section }: { records: readonly PersonalRecord[]; workout: Pick<WorkoutDetail, "exercises">; pref: UnitPreference; section: LedgerSection }): RecordLedger {
  const groups = new Map<string, PersonalRecord[]>();
  for (const r of visibleRecords(records)) {
    const list = groups.get(r.exerciseId);
    if (list) list.push(r);
    else groups.set(r.exerciseId, [r]);
  }
  // The same exercise twice in a workout takes its first position (AC10).
  const position = new Map<string, number>();
  for (const e of workout.exercises) position.set(e.exerciseId, Math.min(position.get(e.exerciseId) ?? Number.POSITIVE_INFINITY, e.position));
  const sets = new Map(workout.exercises.flatMap((e) => e.sets.map((s) => [s.id, { set: s, modality: e.modalitySnapshot }] as const)));
  const sourceOf = (setId: PersonalRecord["sourceSetId"]): string | null => {
    const found = sets.get(setId);
    return found ? `from your ${formatSet(found.set, found.modality)}` : null;
  };

  type Built = { order: number; name: string } & ({ kind: "lift"; lift: LedgerLift } | { kind: "first"; first: FirstTimeLine });
  const built: Built[] = [...groups.entries()].map(([key, group]) => {
    const ordered = [...group].sort((a, b) => typeOrder(a) - typeOrder(b));
    const name = ordered[0]!.exerciseName;
    const slots = group.map((r) => position.get(r.sourceExerciseId)).filter((n): n is number => n !== undefined);
    const order = slots.length > 0 ? Math.min(...slots) : Number.POSITIVE_INFINITY;
    const beaten = ordered.filter((r) => r.previousValue !== null).map((r) => ({ record: r, pair: formatRecordPair(r, pref) }));
    // AC6 (17.2 D16): an est. 1-rep max whose rounded gain is not a rise is dropped while another beaten row shows.
    const shown = beaten.filter((b) => !(b.record.recordType === "best_est_1rm" && b.pair.gainText === null && beaten.length > 1));
    if (shown.length === 0) {
      // AC12 (D1): a lift that beat nothing is one quiet line, led by its first record in type order.
      const lead = ordered[0]!;
      const value = formatRecordByType(lead.recordType, lead.value, lead.unit, pref);
      const text = lead.recordType === "best_est_1rm" ? `First time logged: ${name}, est. 1-rep max ${value}` : `First time logged: ${name} ${value}`;
      return { order, name, kind: "first", first: { key, text } };
    }
    const shared = shown.every((b) => b.record.sourceSetId === shown[0]!.record.sourceSetId);
    const rows: LedgerRow[] = shown.map(({ record, pair }) => {
      const label = recordLabel(record.recordType);
      return { type: record.recordType, label, oldText: pair.oldText, newText: pair.newText, gainText: pair.gainText, spoken: `${label}: ${pair.spoken}`, sourceText: shared ? null : sourceOf(record.sourceSetId) };
    });
    return {
      order,
      name,
      kind: "lift",
      lift: { key, name, rows, sourceText: shared ? sourceOf(shown[0]!.record.sourceSetId) : null, hasEstimate: rows.some((r) => r.type === "best_est_1rm") },
    };
  });
  // AC10 (17.2 AC25, D17): the workout's exercise order; a lift that can't be matched goes after, in name order.
  built.sort((a, b) => (a.order === b.order ? a.name.localeCompare(b.name, "en") : a.order - b.order));
  const lifts = built.flatMap((b) => (b.kind === "lift" ? [b.lift] : []));
  const firsts = built.flatMap((b) => (b.kind === "first" ? [b.first] : []));
  return { heading: headingOf(lifts, section), lifts, firsts };
}
