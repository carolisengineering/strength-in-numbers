import { HEVY_ROUTINE_NOTICE_CODES, type CodeCount, type HevyRoutineNoticeCode } from "../dto/hevy-import.js";
import type { HevyRoutine, HevyRoutineSet } from "../dto/hevy-api.js";
import { PLANNED_SETS_PER_ITEM_MAX, type PlannedSetInput } from "../dto/planned-set.js";
import { ROUTINE_ITEM_NOTES_MAX, ROUTINE_ITEMS_MAX, ROUTINE_NAME_MAX, SUPERSET_GROUP_MEMBERS_MAX, type RoutineItemInput, type RoutineWrite } from "../dto/routine.js";
import type { RoutineSectionInput } from "../dto/routine-section.js";
import { forbiddenMeasuresFor, SET_WEIGHT_MAX } from "../dto/set-entry.js";
import type { Modality, UnitPreference } from "../enums.js";
import { CodeCounter, cleanLine, cleanNotes } from "./importText.js";
import { SectionWalk, unpairedTemplateIds, usableExercise, type HevyImportContext } from "./importShared.js";
import { assignSupersets } from "./importWorkout.js";
import { HEVY_TO_SIN_SET_TYPE, hevyWeightFromKg } from "./sets.js";
import type { HevySetType } from "./vocabulary.js";

export type HevyRoutineTranslation =
  | { ok: true; input: RoutineWrite; notices: CodeCount<HevyRoutineNoticeCode>[] }
  | { ok: false; reason: "unpaired"; unpaired: string[] }
  | { ok: false; reason: "no_items"; unpaired: [] };

/** The name a routine gets when its Hevy title is blank after cleaning (`RoutineWriteSchema` needs one). */
const BLANK_ROUTINE_NAME = "Hevy routine";
const REST_MAX = 900;
const REPS_MIN = 1;
const REPS_MAX = 100;

const clampReps = (n: number) => Math.min(REPS_MAX, Math.max(REPS_MIN, Math.round(n)));

/** AC11: Hevy's rep range (ordered, clamped to 1–100), else `reps` ≥ 1 in both, else none. */
function repsOf(s: HevyRoutineSet): { repsLow: number; repsHigh: number } | null {
  const start = s.rep_range?.start ?? null;
  const end = s.rep_range?.end ?? null;
  if (start !== null || end !== null) {
    const a = clampReps(start ?? end!);
    const b = clampReps(end ?? start!);
    return { repsLow: Math.min(a, b), repsHigh: Math.max(a, b) };
  }
  if (s.reps != null && s.reps >= REPS_MIN) {
    const r = clampReps(s.reps);
    return { repsLow: r, repsHigh: r };
  }
  return null;
}

/**
 * One planned row in the measures the SIN modality can plan (D14): reps only where the measure table allows reps,
 * weight (in the user's unit, to 0.1) only where it allows weight. Plans never carry time or distance (09.1 D8).
 */
function rowOf(s: HevyRoutineSet, modality: Modality, unit: UnitPreference, notices: CodeCounter<HevyRoutineNoticeCode>): PlannedSetInput {
  const forbidden = forbiddenMeasuresFor(modality);
  // An own-key check, so a type named after a prototype key ("toString", "__proto__") falls back too (minor 147).
  const row: PlannedSetInput = { setType: Object.hasOwn(HEVY_TO_SIN_SET_TYPE, s.type) ? HEVY_TO_SIN_SET_TYPE[s.type as HevySetType] : "working" };
  const reps = repsOf(s);
  if (reps !== null && !forbidden.includes("reps")) Object.assign(row, reps);
  if (s.weight_kg != null && s.weight_kg > 0 && !forbidden.includes("weight")) {
    const weight = hevyWeightFromKg(s.weight_kg, unit);
    if (weight > 0 && weight <= SET_WEIGHT_MAX) Object.assign(row, { weight, weightUnit: unit });
  }
  if (s.duration_seconds != null && s.duration_seconds > 0) notices.add("time_targets_not_kept");
  if (s.distance_meters != null && s.distance_meters > 0) notices.add("distance_targets_not_kept");
  return row;
}

interface Candidate {
  item: RoutineItemInput;
  sectionIndex: number | null;
  hevyGroup: number | null;
  notices: CodeCounter<HevyRoutineNoticeCode>;
}

/**
 * Spec 19.1 AC11: a Hevy routine as a `POST /v1/routines` body in the `sets` form, or why not. Placeholders become
 * sections (AC3's naming, at most 8, loose first), skips are left out, and every cap is applied with a notice, so the
 * body always parses with `RoutineWriteSchema` and passes `plannedSetViolations`. A superset never spans a section
 * (the schema refuses it): groups are per (section, Hevy superset id), kept with 2–8 members.
 */
/**
 * Minor 243: the name a Hevy routine gets in SIN (control characters removed, trimmed, cut to `ROUTINE_NAME_MAX`
 * code points; empty is "Hevy routine"). The import screen's duplicate-name check keys on this, lowercased.
 */
export function hevyRoutineName(title: string | null): string {
  return cleanLine(title, ROUTINE_NAME_MAX).value ?? BLANK_ROUTINE_NAME;
}

export function translateHevyRoutine(routine: HevyRoutine, ctx: Omit<HevyImportContext, "now">): HevyRoutineTranslation {
  const unpaired = unpairedTemplateIds(
    routine.exercises.map((e) => e.exercise_template_id),
    ctx,
  );
  if (unpaired.length > 0) return { ok: false, reason: "unpaired", unpaired };

  const notices = new CodeCounter<HevyRoutineNoticeCode>(HEVY_ROUTINE_NOTICE_CODES);
  const name = cleanLine(routine.title, ROUTINE_NAME_MAX);
  if (name.cut) notices.add("name_trimmed");

  const walk = new SectionWalk(notices);
  const candidates: Candidate[] = [];
  for (const e of routine.exercises) {
    const pair = ctx.pairs.get(e.exercise_template_id)!;
    if (pair.role === "warmup_placeholder" || pair.role === "workout_placeholder") {
      walk.placeholder(pair.role, e.notes ?? null);
      continue;
    }
    if (pair.role === "skip") continue;
    const info = usableExercise(pair, ctx)!;
    const own = new CodeCounter<HevyRoutineNoticeCode>(HEVY_ROUTINE_NOTICE_CODES);
    const item: RoutineItemInput = { exerciseId: pair.exerciseId! as RoutineItemInput["exerciseId"] };
    if (e.rest_seconds != null) {
      const rest = Math.round(e.rest_seconds);
      const clamped = Math.min(REST_MAX, Math.max(0, rest));
      if (clamped !== rest) own.add("rest_clamped");
      item.restSeconds = clamped;
    }
    const notes = cleanNotes(e.notes ?? null, ROUTINE_ITEM_NOTES_MAX);
    if (notes.cut) own.add("notes_trimmed");
    if (notes.value !== null) item.notes = notes.value;
    if (e.sets.length > PLANNED_SETS_PER_ITEM_MAX) own.add("sets_cut");
    item.sets = e.sets.slice(0, PLANNED_SETS_PER_ITEM_MAX).map((s) => rowOf(s, info.modality, ctx.unit, own));
    candidates.push({ item, sectionIndex: walk.place(), hevyGroup: e.superset_id ?? null, notices: own });
  }
  walk.finish();

  if (candidates.length > ROUTINE_ITEMS_MAX) notices.add("items_cut", candidates.length - ROUTINE_ITEMS_MAX);
  const kept = candidates.slice(0, ROUTINE_ITEMS_MAX);
  if (kept.length === 0) return { ok: false, reason: "no_items", unpaired: [] };

  // Sections the cap emptied are removed; the rest keep their order and get dense request keys.
  const used = [...new Set(kept.flatMap((c) => (c.sectionIndex === null ? [] : [c.sectionIndex])))];
  walk.keep(used);
  const keyOf = new Map(used.map((index, j) => [index, `s${j + 1}`]));
  const sections: RoutineSectionInput[] = used.map((index) => {
    const s = walk.sections[index]!;
    return { key: keyOf.get(index)!, name: s.name, ...(s.notes === null ? {} : { notes: s.notes }) };
  });

  const supersets = assignSupersets(
    kept.map((c) => (c.hevyGroup === null ? null : `${c.sectionIndex ?? "loose"}:${c.hevyGroup}`)),
    { maxMembers: SUPERSET_GROUP_MEMBERS_MAX },
  );
  if (supersets.cut > 0) notices.add("superset_cut", supersets.cut);

  const items = kept.map((c, i) => {
    for (const n of c.notices.list()) notices.add(n.code, n.count);
    const group = supersets.groups[i]!;
    return {
      ...c.item,
      ...(group === null ? {} : { supersetGroup: group }),
      ...(c.sectionIndex === null ? {} : { sectionKey: keyOf.get(c.sectionIndex)! }),
    };
  });

  const input: RoutineWrite = { name: hevyRoutineName(routine.title), items };
  if (sections.length > 0) input.sections = sections;
  return { ok: true, input, notices: notices.list() };
}
