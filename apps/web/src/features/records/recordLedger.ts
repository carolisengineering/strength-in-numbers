import { RECORD_TYPE_VALUES, type PersonalRecord, type RecordType, type UnitPreference, type WorkoutDetail } from "@sin/core";

import { formatRecordByType, formatRecordPair } from "../units/format";
import { formatSet } from "../workouts/format";
import { recordRowLabel } from "./labels";

/**
 * Spec 17.6 §6.1: the pure model behind the summary's record ledger. Every decision (what is shown, what leads, what
 * the heading counts, which "from your …" line goes where, the order) is made here and table-tested; the components only
 * render it. No PR math: this formats what 07.0 stored, and every figure goes through `formatRecordPair`.
 */
/** "3 lifts" / "1 lift": the summary heading's count, also History's badge (Spec 07.6 AC16), so the two say it alike. */
export function liftCountText(n: number): string {
  return `${n} ${n === 1 ? "lift" : "lifts"}`;
}

export type LedgerSection = "workouts" | "history";

export interface LedgerRow {
  /** Unique within its lift: the type, and the weight for most reps at a weight (07.5 AC36: one row per weight). */
  readonly key: string;
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
  /** The line leads with an est. 1-rep max (minor 477). */
  readonly estimate: boolean;
}

export interface RecordLedger {
  /** Null when no lift rose: then there is no panel and no brass (AC13; AC6, minor 476). */
  readonly heading: string | null;
  /**
   * The lifts the heading counts: those with a row that rose (minor 476), 0 when `heading` is null. A value-only lift is
   * drawn but never counted, so `lifts.length` is not the count. Spec 06.7's landed line reads it (AC27, D18).
   */
  readonly counted: number;
  /** The panel's lifts; empty when `heading` is null. */
  readonly lifts: readonly LedgerLift[];
  readonly firsts: readonly FirstTimeLine[];
  /**
   * Minor 477: a first line leads with an est. 1-rep max and the panel draws no estimate row (or isn't drawn), so the
   * lines carry AC9's explanation themselves. Never both.
   */
  readonly explainFirsts: boolean;
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

/**
 * 17.2 AC16: set-volume records are not shown on the summary (they stay in the cache and in Progress). Spec 07.5 AC37
 * (D9): a first time at a weight shows nothing here either (no row, no line, no count); the exercise page lists it.
 */
export function visibleRecords(records: readonly PersonalRecord[]): PersonalRecord[] {
  return records.filter((r) => r.recordType !== "best_set_volume" && !(r.recordType === "max_reps_at_weight" && r.previousValue === null));
}

/** Type order, then the heavier weight first (07.5 AC36); only most reps at a weight carries a weight. */
const byTypeThenWeight = (a: PersonalRecord, b: PersonalRecord) =>
  RECORD_TYPE_VALUES.indexOf(a.recordType) - RECORD_TYPE_VALUES.indexOf(b.recordType) || (b.atWeightKg ?? 0) - (a.atWeightKg ?? 0);

/** AC6 (owner decision 2026-11-14, minor 476): a lift counts only when one of its rows rose. */
const rose = (lift: LedgerLift): boolean => lift.rows.some((r) => r.gainText !== null);

function headingOf(lifts: readonly LedgerLift[], counted: number, section: LedgerSection): string | null {
  if (counted === 0) return null;
  const oneRow = lifts.length === 1 && lifts[0]!.rows.length === 1;
  const count = liftCountText(counted);
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

  /** AC12 (D1): a first-ever number's quiet line, led by `lead`. */
  const firstLine = (key: string, name: string, lead: PersonalRecord): FirstTimeLine => {
    const value = formatRecordByType(lead.recordType, lead.value, lead.unit, pref);
    const estimate = lead.recordType === "best_est_1rm";
    return { key, text: estimate ? `First time logged: ${name}, est. 1-rep max ${value}` : `First time logged: ${name} ${value}`, estimate };
  };

  type Built = { order: number; name: string } & ({ kind: "lift"; lift: LedgerLift; first: FirstTimeLine | null } | { kind: "first"; first: FirstTimeLine });
  const built: Built[] = [...groups.entries()].map(([key, group]) => {
    const ordered = [...group].sort(byTypeThenWeight);
    const slots = group.map((r) => position.get(r.sourceExerciseId)).filter((n): n is number => n !== undefined);
    const order = slots.length > 0 ? Math.min(...slots) : Number.POSITIVE_INFINITY;
    const beaten = ordered.filter((r) => r.previousValue !== null).map((r) => ({ record: r, pair: formatRecordPair(r, pref) }));
    // AC6 (17.2 D16): an est. 1-rep max whose rounded gain is not a rise is dropped while another beaten row shows.
    const shown = beaten.filter((b) => !(b.record.recordType === "best_est_1rm" && b.pair.gainText === null && beaten.length > 1));
    // Each record carries its own source snapshot's name: name the lift by a row it shows, else by its lead record.
    const name = (shown[0]?.record ?? ordered[0]!).exerciseName;
    // AC12 (D1): a lift that beat nothing is one quiet line, led by its first record in type order.
    if (shown.length === 0) return { order, name, kind: "first", first: firstLine(key, name, ordered[0]!) };
    // Minor 476: if no lift rises, this one's rows aren't drawn; a first-ever record it holds becomes its line instead.
    const firstRecord = ordered.find((r) => r.previousValue === null);
    const shared = shown.every((b) => b.record.sourceSetId === shown[0]!.record.sourceSetId);
    const rows: LedgerRow[] = shown.map(({ record, pair }) => {
      const label = recordRowLabel(record, pref);
      return { key: `${record.recordType}:${record.atWeightKg ?? ""}`, type: record.recordType, label, oldText: pair.oldText, newText: pair.newText, gainText: pair.gainText, spoken: `${label}: ${pair.spoken}`, sourceText: shared ? null : sourceOf(record.sourceSetId) };
    });
    return {
      order,
      name,
      kind: "lift",
      lift: { key, name, rows, sourceText: shared ? sourceOf(shown[0]!.record.sourceSetId) : null, hasEstimate: rows.some((r) => r.type === "best_est_1rm") },
      first: firstRecord ? firstLine(key, name, firstRecord) : null,
    };
  });
  // AC10 (17.2 AC25, D17): the workout's exercise order; a lift that can't be matched goes after, in name order.
  built.sort((a, b) => (a.order === b.order ? a.name.localeCompare(b.name, "en") : a.order - b.order));
  const drawn = built.flatMap((b) => (b.kind === "lift" ? [b.lift] : []));
  const rising = drawn.filter(rose).length;
  const heading = headingOf(drawn, rising, section);
  // Minor 476: with no panel, a value-only lift is gone; only a first-ever record it held stays, as its line.
  const lifts = heading === null ? [] : drawn;
  const firsts = built.flatMap((b) => (b.kind === "first" ? [b.first] : heading === null && b.first !== null ? [b.first] : []));
  const explainFirsts = firsts.some((f) => f.estimate) && !lifts.some((l) => l.hasEstimate);
  return { heading, counted: heading === null ? 0 : rising, lifts, firsts, explainFirsts };
}
