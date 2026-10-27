import type { HevyPostExercise, HevyPostWorkout } from "../dto/hevy-api.js";
import type { WorkoutDetail, WorkoutExerciseDetail, WorkoutSection } from "../dto/workout.js";
import type { Modality } from "../enums.js";
import { hevyPairingProblem } from "./pairing.js";
import { sectionTreatment } from "./sections.js";
import { HEVY_EXPORT_NOTICES, sinSetToHevy, type ExportNotice, type ExportNoticeCode } from "./sets.js";
import type { HevyMapping, HevyPair } from "./types.js";
import type { HevyType } from "./vocabulary.js";

/** An exercise in the workout that has no usable export pair. */
export interface UnmappedExercise {
  exerciseId: string;
  name: string;
  modality: Modality;
}

export type HevyWorkoutBuild = { ok: true; body: HevyPostWorkout; notices: ExportNotice[] } | { ok: false; unmapped: UnmappedExercise[] };

/**
 * Spec 19.0 AC11: the export pair for a SIN exercise: its own `exportAs` pair, else the `exportAs` pair of any
 * exercise in the same lineage (`rootOf` is injected, so this stays pure). Spec 20.2 lists unmatched exercises with it.
 * Given the type the sets were logged as, a pair that no longer pairs with it (a stale pair, AC25, or a fork retyped
 * away from its root's pair) is not usable, so its sets are never sent without their measures.
 */
export function exportPairFor(
  exerciseId: string,
  mapping: HevyMapping,
  rootOf: (id: string) => string,
  modality?: Modality,
): (HevyPair & { hevyType: HevyType }) | null {
  const usable = mapping.pairs.filter(
    (p): p is HevyPair & { hevyType: HevyType } =>
      p.role === "exercise" &&
      p.exportAs &&
      p.exerciseId !== null &&
      p.hevyType !== null &&
      (modality === undefined || hevyPairingProblem(p.hevyType, modality, p.measureRule) === null),
  );
  const own = usable.find((p) => p.exerciseId === exerciseId);
  if (own) return own;
  const root = rootOf(exerciseId);
  return usable.find((p) => rootOf(p.exerciseId!) === root) ?? null;
}

const joinNotes = (prefix: string, notes: string | null): string => (notes ? `${prefix}\n\n${notes}` : prefix);
const nameAndNote = (s: WorkoutSection): string => (s.notes ? `${s.name}\n${s.notes}` : s.name);

/**
 * Spec 19.0 AC11–AC12: the body to send to Hevy for a finished workout. Pure and total: the input is never mutated,
 * an unsendable set is counted and left out, and every exercise needs an export pair (else `ok: false` with the
 * unmapped list and nothing else computed). Sections follow AC10: a marker exercise for Warm-up and named sections,
 * the note on the first exercise for Accessory, and the name and note on the first exercise when the marker pair is
 * missing.
 */
export function buildHevyWorkout(
  detail: WorkoutDetail,
  mapping: HevyMapping,
  deps: { rootOf: (exerciseId: string) => string },
): HevyWorkoutBuild {
  const exercises = [...detail.exercises].sort((a, b) => a.position - b.position);

  const pairs = new Map<WorkoutExerciseDetail, HevyPair & { hevyType: HevyType }>();
  const unmapped = new Map<string, UnmappedExercise>();
  for (const ex of exercises) {
    const p = exportPairFor(ex.exerciseId, mapping, deps.rootOf, ex.modalitySnapshot);
    if (p) pairs.set(ex, p);
    else if (!unmapped.has(ex.exerciseId)) unmapped.set(ex.exerciseId, { exerciseId: ex.exerciseId, name: ex.exerciseNameSnapshot, modality: ex.modalitySnapshot });
  }
  if (unmapped.size > 0) return { ok: false, unmapped: [...unmapped.values()] };

  const counts = new Map<ExportNoticeCode, number>();
  const count = (code: ExportNoticeCode, by = 1) => counts.set(code, (counts.get(code) ?? 0) + by);
  const markerless: string[] = [];

  const groupSize = new Map<number, number>();
  for (const ex of exercises) if (ex.supersetGroup !== null) groupSize.set(ex.supersetGroup, (groupSize.get(ex.supersetGroup) ?? 0) + 1);
  const supersetIds = new Map<number, number>();
  const supersetId = (group: number | null): number | null => {
    if (group === null || (groupSize.get(group) ?? 0) < 2) return null;
    if (!supersetIds.has(group)) supersetIds.set(group, supersetIds.size);
    return supersetIds.get(group)!;
  };

  const sections = new Map(detail.sections.map((s) => [s.id, s]));
  const markerPair = (role: "warmup_placeholder" | "workout_placeholder") => mapping.pairs.find((p) => p.role === role) ?? null;

  const out: HevyPostExercise[] = [];
  let previousSection: string | null = null;
  for (const ex of exercises) {
    let notes = ex.notes;
    const sec = ex.sectionId === null ? undefined : sections.get(ex.sectionId);
    // A section's treatment applies where a run of its exercises starts (a workout's list may be non-contiguous).
    if (sec && ex.sectionId !== previousSection) {
      const treatment = sectionTreatment(sec.name, mapping.sectionRules);
      if (treatment === "notes_on_first") {
        if (sec.notes) notes = joinNotes(sec.notes, notes);
      } else {
        const marker = markerPair(treatment);
        if (marker) {
          out.push({
            exercise_template_id: marker.hevyTemplateId,
            superset_id: null,
            notes: treatment === "warmup_placeholder" ? sec.notes : nameAndNote(sec),
            sets: [],
          });
        } else {
          notes = joinNotes(nameAndNote(sec), notes);
          count("section_no_placeholder");
          markerless.push(sec.name);
        }
      }
    }
    previousSection = ex.sectionId;

    const p = pairs.get(ex)!;
    const sets = [...ex.sets]
      .sort((a, b) => a.setNumber - b.setNumber)
      .flatMap((s) => {
        const r = sinSetToHevy(s, { modality: ex.modalitySnapshot, hevyType: p.hevyType, rule: p.measureRule });
        if (!r.ok) {
          count("sets_not_sent");
          return [];
        }
        for (const code of r.notices) count(code);
        return [r.set];
      });
    out.push({ exercise_template_id: p.hevyTemplateId, superset_id: supersetId(ex.supersetGroup), notes, sets });
  }

  const ownTitle = detail.title?.trim() ? detail.title : null;
  const title = ownTitle ?? (detail.routineName?.trim() ? detail.routineName : null) ?? "Workout";
  if (ownTitle === null) count("title_fallback");

  const notices: ExportNotice[] = HEVY_EXPORT_NOTICES.filter((code) => counts.has(code)).map((code) =>
    code === "section_no_placeholder" ? { code, count: counts.get(code)!, names: markerless } : { code, count: counts.get(code)! },
  );

  return {
    ok: true,
    notices,
    body: {
      workout: {
        title,
        description: detail.notes ?? null,
        start_time: new Date(detail.startedAt).toISOString(),
        end_time: new Date(detail.endedAt ?? detail.startedAt).toISOString(),
        is_private: true,
        exercises: out,
      },
    },
  };
}
