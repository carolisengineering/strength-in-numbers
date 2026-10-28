import {
  HEVY_IMPORT_DROP_CODES,
  HEVY_IMPORT_NOTICE_CODES,
  type CodeCount,
  type HevyImportDropCode,
  type HevyImportNoticeCode,
  type HevyImportSetInput,
  type HevyImportWorkout,
} from "../dto/hevy-import.js";
import { WORKOUT_NOTES_MAX, WORKOUT_TITLE_MAX } from "../dto/workout.js";
import type { Modality, UnitPreference } from "../enums.js";
import { CodeCounter, cleanLine, cleanNotes, importTimes } from "./importText.js";
import { hevySetToSin, type HevyImportSet, type ImportedSet, type SetDropReason, type SetIgnored } from "./sets.js";
import type { HevyPair } from "./types.js";

/** What the import knows about one of the caller's SIN exercises. */
export interface ImportExerciseInfo {
  name: string;
  modality: Modality;
  active: boolean;
  /** The lineage root: `COALESCE(forked_from_exercise_id, id)`. */
  rootId: string;
}

/** Loaded once per request (§6.1): the mapping by Hevy template id, the exercises by SIN id, the unit, the clock. */
export interface HevyImportContext {
  pairs: ReadonlyMap<string, HevyPair>;
  exercises: ReadonlyMap<string, ImportExerciseInfo>;
  unit: UnitPreference;
  now: Date;
}

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

/** The stored SIN exercise an `exercise` pair points at, or `null` when the pair cannot be used (AC4). */
function usableExercise(pair: HevyPair | undefined, ctx: HevyImportContext): ImportExerciseInfo | null {
  if (pair === undefined || pair.role !== "exercise") return null;
  if (pair.exerciseId === null || pair.hevyType === null) return null;
  const info = ctx.exercises.get(pair.exerciseId);
  return info !== undefined && info.active ? info : null;
}

/** AC4: the template ids with no usable pair, each once, in first-seen order. */
function unpairedIds(w: HevyImportWorkout, ctx: HevyImportContext): string[] {
  const out = new Set<string>();
  for (const e of w.exercises) {
    const pair = ctx.pairs.get(e.exerciseTemplateId);
    if (pair !== undefined && pair.role !== "exercise") continue;
    if (usableExercise(pair, ctx) === null) out.add(e.exerciseTemplateId);
  }
  return [...out];
}

/**
 * Spec 19.1 AC2–AC9: one Hevy workout as SIN rows, or why it is not imported. `time_invalid` wins, then `unpaired`
 * (nothing else is computed), then `no_usable_sets`. Every dropped set and every value set aside is counted. Pure:
 * the clock is `ctx.now`, and equal inputs give equal results.
 */
export function translateHevyWorkout(w: HevyImportWorkout, ctx: HevyImportContext): HevyWorkoutTranslation {
  const times = importTimes(w, ctx.now);
  if (!times.ok) return { outcome: "time_invalid" };

  const unpaired = unpairedIds(w, ctx);
  if (unpaired.length > 0) return { outcome: "unpaired", unpaired };

  const drops = new CodeCounter<HevyImportDropCode>(HEVY_IMPORT_DROP_CODES);
  const notices = new CodeCounter<HevyImportNoticeCode>(HEVY_IMPORT_NOTICE_CODES);
  const title = cleanLine(w.title, WORKOUT_TITLE_MAX);
  if (title.cut) notices.add("title_trimmed");
  const notes = cleanNotes(w.description, WORKOUT_NOTES_MAX);
  if (notes.cut) notices.add("notes_trimmed");

  const exercises: ImportedExercise[] = [];
  for (const e of w.exercises) {
    const pair = ctx.pairs.get(e.exerciseTemplateId)!;
    if (pair.role === "warmup_placeholder" || pair.role === "workout_placeholder") {
      notices.add("placeholder_sets_ignored", e.sets.length);
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
      sets.push({ ...r.set, setNumber: sets.length + 1 });
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
      sectionIndex: null,
      sets,
    });
  }

  if (exercises.length === 0) return { outcome: "no_usable_sets", drops: drops.list(), notices: notices.list() };

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
      sections: [],
      exercises,
      rootIds,
    },
    drops: drops.list(),
    notices: notices.list(),
  };
}
