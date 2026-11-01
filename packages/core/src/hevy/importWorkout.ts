import {
  HEVY_IMPORT_DROP_CODES,
  HEVY_IMPORT_NOTICE_CODES,
  type CodeCount,
  type HevyImportDropCode,
  type HevyImportNoticeCode,
  type HevyImportSetInput,
  type HevyImportWorkout,
} from "../dto/hevy-import.js";
import { SUPERSET_GROUP_VALUE_MAX } from "../dto/routine.js";
import { WORKOUT_NOTES_MAX, WORKOUT_TITLE_MAX } from "../dto/workout.js";
import type { Modality } from "../enums.js";
import { CodeCounter, cleanLine, cleanNotes, importTimes } from "./importText.js";
import { SectionWalk, unpairedTemplateIds, usableExercise, type HevyImportContext } from "./importShared.js";
import { hevySetToSin, type HevyImportSet, type ImportedSet, type SetDropReason, type SetIgnored } from "./sets.js";

export type { HevyImportContext, ImportExerciseInfo } from "./importShared.js";

/** One stored set: 19.0's translated set plus its number in the exercise. */
export type ImportedWorkoutSet = ImportedSet & { setNumber: number };

export interface ImportedExercise {
  exerciseId: string;
  nameSnapshot: string;
  modalitySnapshot: Modality;
  notes: string | null;
  supersetGroup: number | null;
  /** Index into `ImportedWorkout.sections`, or `null` for a loose exercise. */
  sectionIndex: number | null;
  sets: ImportedWorkoutSet[];
}

export interface ImportedWorkout {
  title: string | null;
  notes: string | null;
  startedAt: string;
  endedAt: string;
  localDate: string;
  tzOffsetMinutes: number;
  sections: { name: string; notes: string | null }[];
  exercises: ImportedExercise[];
  /** The distinct lineage roots of the stored exercises, in first-seen order. */
  rootIds: string[];
}

export type HevyWorkoutTranslation =
  | { outcome: "create"; workout: ImportedWorkout; drops: CodeCount<HevyImportDropCode>[]; notices: CodeCount<HevyImportNoticeCode>[] }
  | { outcome: "time_invalid" }
  | { outcome: "unpaired"; unpaired: string[] }
  | { outcome: "no_usable_sets"; drops: CodeCount<HevyImportDropCode>[]; notices: CodeCount<HevyImportNoticeCode>[] };

const DROP_FOR: Readonly<Record<SetDropReason, HevyImportDropCode>> = Object.freeze({
  missing_measure: "set_missing_measure",
  forbidden_measure: "set_forbidden_measure",
  out_of_range: "set_out_of_range",
});

/** `zero_forbidden` loses nothing (a 0 in a measure the type cannot hold), so it has no notice. */
const NOTICE_FOR: Readonly<Record<SetIgnored, HevyImportNoticeCode | null>> = Object.freeze({
  custom_metric: "custom_metric_ignored",
  assist_weight: "assist_weight_ignored",
  zero_forbidden: null,
});

/**
 * An RPE SIN can store (`CreateSetSchema`: 1–10 in tenths), else `null`. Hevy sends its own steps, but this request
 * is whatever the client posts, and a value the column or a later edit would refuse must never be stored.
 */
function storableRpe(rpe: number | null): number | null {
  if (rpe === null || rpe < 1 || rpe > 10) return null;
  return Math.abs(rpe * 10 - Math.round(rpe * 10)) < 1e-9 ? rpe : null;
}

/** The request's camelCase set in 19.0's snake_case Hevy shape. */
function toHevySet(s: HevyImportSetInput): HevyImportSet {
  return {
    type: s.type,
    weight_kg: s.weightKg,
    reps: s.reps,
    distance_meters: s.distanceMeters,
    duration_seconds: s.durationSeconds,
    rpe: s.rpe,
    custom_metric: s.customMetric,
  };
}

/**
 * AC7 / AC11: superset groups for stored items in order. Each distinct key with at least two members becomes 1, 2,
 * 3… in order of first appearance; a key with one member is `null`; a group past `SUPERSET_GROUP_VALUE_MAX` is
 * `null` (`overLimit`, per group); with `maxMembers`, members past it are `null` (`cut`, per group).
 */
export function assignSupersets<K>(
  ids: readonly (K | null)[],
  opts: { maxMembers?: number } = {},
): { groups: (number | null)[]; overLimit: number; cut: number } {
  const members = new Map<K, number>();
  for (const id of ids) if (id !== null) members.set(id, (members.get(id) ?? 0) + 1);
  const numbers = new Map<K, number | null>();
  let next = 1;
  let overLimit = 0;
  let cut = 0;
  for (const [id, n] of members) {
    if (n < 2) {
      numbers.set(id, null);
    } else if (next > SUPERSET_GROUP_VALUE_MAX) {
      numbers.set(id, null);
      overLimit += 1;
    } else {
      numbers.set(id, next);
      next += 1;
      if (opts.maxMembers !== undefined && n > opts.maxMembers) cut += 1;
    }
  }
  const seen = new Map<K, number>();
  const groups = ids.map((id) => {
    if (id === null) return null;
    const k = (seen.get(id) ?? 0) + 1;
    seen.set(id, k);
    return opts.maxMembers !== undefined && k > opts.maxMembers ? null : numbers.get(id)!;
  });
  return { groups, overLimit, cut };
}

/**
 * Spec 19.1 AC2–AC9: one Hevy workout as SIN rows, or why it is not imported. `time_invalid` wins, then `unpaired`
 * (nothing else is computed), then `no_usable_sets`. Every dropped set and every value set aside is counted. Pure:
 * the clock is `ctx.now`, and equal inputs give equal results.
 */
export function translateHevyWorkout(w: HevyImportWorkout, ctx: HevyImportContext): HevyWorkoutTranslation {
  const times = importTimes(w, ctx.now);
  if (!times.ok) return { outcome: "time_invalid" };

  const unpaired = unpairedTemplateIds(
    w.exercises.map((e) => e.exerciseTemplateId),
    ctx,
  );
  if (unpaired.length > 0) return { outcome: "unpaired", unpaired };

  const drops = new CodeCounter<HevyImportDropCode>(HEVY_IMPORT_DROP_CODES);
  const notices = new CodeCounter<HevyImportNoticeCode>(HEVY_IMPORT_NOTICE_CODES);
  const title = cleanLine(w.title, WORKOUT_TITLE_MAX);
  if (title.cut) notices.add("title_trimmed");
  const notes = cleanNotes(w.description, WORKOUT_NOTES_MAX);
  if (notes.cut) notices.add("notes_trimmed");

  const walk = new SectionWalk(notices);
  const exercises: ImportedExercise[] = [];
  const hevyGroups: (number | null)[] = [];
  for (const e of w.exercises) {
    const pair = ctx.pairs.get(e.exerciseTemplateId)!;
    if (pair.role === "warmup_placeholder" || pair.role === "workout_placeholder") {
      notices.add("placeholder_sets_ignored", e.sets.length);
      walk.placeholder(pair.role, e.notes);
      continue;
    }
    if (pair.role === "skip") {
      drops.add("exercise_skipped", e.sets.length);
      continue;
    }
    const info = usableExercise(pair, ctx)!;
    const setCtx = { hevyType: pair.hevyType!, modality: info.modality, rule: pair.measureRule, unit: ctx.unit };
    const sets: ImportedWorkoutSet[] = [];
    for (const s of e.sets) {
      const r = hevySetToSin(toHevySet(s), setCtx);
      if (!r.ok) {
        drops.add(DROP_FOR[r.reason]);
        continue;
      }
      for (const ignored of r.ignored) {
        const code = NOTICE_FOR[ignored];
        if (code !== null) notices.add(code);
      }
      sets.push({ ...r.set, rpe: storableRpe(r.set.rpe), setNumber: sets.length + 1 });
    }
    if (sets.length === 0) {
      drops.add("exercise_no_sets");
      continue;
    }
    const exerciseNotes = cleanNotes(e.notes, WORKOUT_NOTES_MAX);
    if (exerciseNotes.cut) notices.add("notes_trimmed");
    exercises.push({
      exerciseId: pair.exerciseId!,
      nameSnapshot: info.name,
      modalitySnapshot: info.modality,
      notes: exerciseNotes.value,
      supersetGroup: null,
      sectionIndex: walk.place(),
      sets,
    });
    hevyGroups.push(e.supersetId);
  }
  walk.finish();
  walk.keep(walk.sections.keys());

  if (exercises.length === 0) return { outcome: "no_usable_sets", drops: drops.list(), notices: notices.list() };

  const supersets = assignSupersets(hevyGroups);
  if (supersets.overLimit > 0) notices.add("superset_over_limit", supersets.overLimit);
  exercises.forEach((x, i) => {
    x.supersetGroup = supersets.groups[i]!;
  });

  const rootIds = [...new Set(exercises.map((x) => ctx.exercises.get(x.exerciseId)!.rootId))];
  return {
    outcome: "create",
    workout: {
      title: title.value,
      notes: notes.value,
      startedAt: times.startedAt,
      endedAt: times.endedAt,
      localDate: times.localDate,
      tzOffsetMinutes: w.tzOffsetMinutes,
      sections: walk.sections,
      exercises,
      rootIds,
    },
    drops: drops.list(),
    notices: notices.list(),
  };
}
