import { MAX_CUSTOM_EXERCISES_PER_USER, type Exercise, type HevyMapping, type HevyRoutine, type HevySet, type HevyTemplate, type HevyType } from "@sin/core";

import type { PairingNeed } from "../pairing";
import { MARKER_TITLES } from "./constants";
import type { HevyRead } from "./readHevy";

/** Spec 20.1 AC8, AC9, AC32, §6.5: which Hevy templates the import still needs a decision for. Pure. */

export interface TemplateUse {
  workouts: number;
  routines: number;
  /** The title the workouts (or routines) use, for a template Hevy no longer lists (AC32). */
  title: string;
  /** Every set logged with it, to infer a missing template's type (AC32). */
  sets: HevySet[];
}

/** Each template the fetched workouts and the picked routines use, with how many of each use it. */
export function templatesUsed(read: HevyRead, pickedRoutines: readonly HevyRoutine[]): Map<string, TemplateUse> {
  const used = new Map<string, TemplateUse>();
  const entry = (id: string, title: string) => {
    const found = used.get(id);
    if (found) return found;
    const fresh: TemplateUse = { workouts: 0, routines: 0, title, sets: [] };
    used.set(id, fresh);
    return fresh;
  };
  for (const w of read.workouts.values()) {
    const seen = new Set<string>();
    for (const e of w.exercises) {
      const use = entry(e.exercise_template_id, e.title);
      // Minor 247: sets only infer the type of a template Hevy no longer lists (AC32); a listed one has its own.
      if (!read.templates.has(e.exercise_template_id)) use.sets.push(...e.sets);
      if (!seen.has(e.exercise_template_id)) use.workouts += 1;
      seen.add(e.exercise_template_id);
    }
  }
  for (const r of pickedRoutines) {
    const seen = new Set<string>();
    for (const e of r.exercises) {
      const use = entry(e.exercise_template_id, e.title);
      if (!seen.has(e.exercise_template_id)) use.routines += 1;
      seen.add(e.exercise_template_id);
    }
  }
  return used;
}

const markerKind = (title: string): "warmup" | "workout" | null => {
  const key = title.trim().toLowerCase();
  return (MARKER_TITLES as readonly string[]).includes(key) ? (key as "warmup" | "workout") : null;
};

/**
 * AC8: a used template titled `Warmup` / `workout` (trimmed, any case) while the mapping has no marker pair of that
 * role and no pair for the template itself (a template already paired is the user's decision). The title is Hevy's
 * template title, or the workouts' own for a template Hevy no longer lists.
 */
export function markersMissing(
  used: ReadonlyMap<string, TemplateUse>,
  templates: ReadonlyMap<string, HevyTemplate>,
  mapping: HevyMapping,
): { warmup: string | null; workout: string | null } {
  const paired = new Set(mapping.pairs.map((p) => p.hevyTemplateId));
  const hasRole = (role: "warmup_placeholder" | "workout_placeholder") => mapping.pairs.some((p) => p.role === role);
  const out: { warmup: string | null; workout: string | null } = { warmup: null, workout: null };
  for (const [id, use] of used) {
    if (paired.has(id)) continue;
    const kind = markerKind(templates.get(id)?.title ?? use.title);
    if (kind === "warmup" && out.warmup === null && !hasRole("warmup_placeholder")) out.warmup = id;
    if (kind === "workout" && out.workout === null && !hasRole("workout_placeholder")) out.workout = id;
  }
  return out;
}

/** AC32: the used templates Hevy's own list no longer has (a deleted custom exercise). */
export function missingTemplates(used: ReadonlyMap<string, TemplateUse>, templates: ReadonlyMap<string, HevyTemplate>): string[] {
  return [...used.keys()].filter((id) => !templates.has(id));
}

/** AC32: a missing template's Hevy type, from the measures its sets carry; none at all is `reps_only`. */
export function inferHevyType(sets: readonly HevySet[]): HevyType {
  const has = (field: "weight_kg" | "reps" | "distance_meters" | "duration_seconds") => sets.some((s) => s[field] != null);
  const weight = has("weight_kg");
  const reps = has("reps");
  const distance = has("distance_meters");
  const duration = has("duration_seconds");
  if (weight && reps) return "weight_reps";
  if (distance && duration) return "distance_duration";
  if (weight && distance) return "short_distance_weight";
  if (weight && duration) return "weight_duration";
  if (weight) return "weight_reps";
  if (distance) return "distance_duration";
  if (duration) return "duration";
  return "reps_only";
}

/**
 * AC9: the templates with no pair, or with an `exercise` pair whose exercise is retired (`exerciseActive: false`, or
 * a synced catalog lacks the row; minor 179's rule), sorted by usage then title. Marker templates the user set aside
 * appear as ordinary needs. Derive only once the catalog has synced, so a row still loading is not read as retired.
 */
export function pairingNeeds(
  used: ReadonlyMap<string, TemplateUse>,
  templates: ReadonlyMap<string, HevyTemplate>,
  mapping: HevyMapping,
  catalog: { visible: readonly Exercise[]; synced: boolean },
): PairingNeed[] {
  const pairs = new Map(mapping.pairs.map((p) => [p.hevyTemplateId, p]));
  const visible = new Set<string>(catalog.visible.map((e) => e.id));
  const needs: PairingNeed[] = [];
  for (const [id, use] of used) {
    const pair = pairs.get(id);
    const retired =
      pair?.role === "exercise" &&
      (pair.exerciseActive === false || (catalog.synced && (pair.exerciseId === null || !visible.has(pair.exerciseId))));
    if (pair !== undefined && !retired) continue;
    const listed = templates.get(id);
    const context = { workouts: use.workouts, routines: use.routines };
    needs.push(
      listed
        ? { template: listed, context }
        : { template: { id, title: use.title, type: inferHevyType(use.sets), is_custom: true }, context, missing: true },
    );
  }
  const usage = (n: PairingNeed) => (n.context?.workouts ?? 0) + (n.context?.routines ?? 0);
  return needs.sort((a, b) => usage(b) - usage(a) || a.template.title.localeCompare(b.template.title) || a.template.id.localeCompare(b.template.id));
}

/** "41 workouts, 1 routine". */
export function usageText(counts: { workouts: number; routines: number }): string {
  const parts: string[] = [];
  if (counts.workouts > 0) parts.push(`${counts.workouts.toLocaleString("en-US")} ${counts.workouts === 1 ? "workout" : "workouts"}`);
  if (counts.routines > 0) parts.push(`${counts.routines.toLocaleString("en-US")} ${counts.routines === 1 ? "routine" : "routines"}`);
  return parts.join(", ");
}

/** AC9: how many more custom exercises fit under the cap (500 minus the visible custom ones). */
export function customExerciseRoom(visible: readonly Exercise[]): number {
  return Math.max(0, MAX_CUSTOM_EXERCISES_PER_USER - visible.filter((e) => e.ownerUserId !== null).length);
}
