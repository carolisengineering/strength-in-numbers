/**
 * Record → wire DTO mappers shared by the read routes and the account export
 * (Spec 11 §6.2, D6/D7). One mapper per shape: the export and the read routes
 * cannot disagree on a field. Keys stay in schema order — the ETag routes hash
 * `JSON.stringify` of these objects as the wire bytes (Spec 03.1 §6.1).
 */
import type { HevyExportLink, HevyPair, HevySectionRule } from "@sin/core";
import type { HevyExportLinkRecord } from "../repositories/account-export.js";
import {
  tenthsToRpe,
  type Exercise,
  type Me,
  type Routine,
  type RoutineItem,
  type RoutineSection,
  type SetEntry,
  type Workout,
  type WorkoutDetail,
  type WorkoutExercise,
  type WorkoutExerciseDetail,
  type WorkoutSection,
} from "@sin/core";
import type { ExerciseRecord } from "../repositories/exercise.js";
import type { RoutineItemRecord, RoutineRecord, RoutineSectionRecord } from "../repositories/routine.js";
import type { UserRecord } from "../repositories/user.js";
import type {
  SetEntryRecord,
  WorkoutDetailRecord,
  WorkoutExerciseRecord,
  WorkoutRecord,
  WorkoutSectionRecord,
} from "../repositories/workout.js";

/**
 * DB row → wire DTO. `id` is a plain string on the row and a branded `UserId` on
 * `MeSchema`; the value is the same UUID, so the brand is asserted here rather
 * than re-parsed.
 */
export function toMeDto(u: UserRecord): Me {
  return {
    id: u.id as Me["id"],
    email: u.email,
    displayName: u.displayName,
    unitPreference: u.unitPreference,
    timezone: u.timezone,
    createdAt: u.createdAt.toISOString(),
  };
}

/** DB record → wire DTO, keys in `ExerciseSchema` field order (§5). The `id` /
 * `ownerUserId` brands and the `modality` enum are guaranteed by the schema +
 * the DB `CHECK`, so they are asserted here rather than re-parsed. */
export function toExerciseDto(r: ExerciseRecord): Exercise {
  return {
    id: r.id as Exercise["id"],
    catalogKey: r.catalogKey,
    ownerUserId: r.ownerUserId as Exercise["ownerUserId"],
    name: r.name,
    modality: r.modality as Exercise["modality"],
    primaryMuscleId: r.primaryMuscleId,
    secondaryMuscleIds: r.secondaryMuscleIds,
    equipmentId: r.equipmentId,
    isActive: r.isActive,
    forkedFromExerciseId: r.forkedFromExerciseId as Exercise["forkedFromExerciseId"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toRoutineItemDto(r: RoutineItemRecord): RoutineItem {
  return {
    id: r.id as RoutineItem["id"],
    position: r.position,
    exerciseId: r.exerciseId as RoutineItem["exerciseId"],
    targetSets: r.targetSets,
    targetRepsLow: r.targetRepsLow,
    targetRepsHigh: r.targetRepsHigh,
    // Spec 09 D5: the one tenths → decimal conversion on this read path.
    targetRpe: r.targetRpeTenths === null ? null : tenthsToRpe(r.targetRpeTenths),
    restSeconds: r.restSeconds,
    supersetGroup: r.supersetGroup,
    notes: r.notes,
    // Spec 09.1: key order matches `PlannedSetSchema` (it is the ETag's wire bytes).
    sets: r.sets.map((s) => ({ ...s })),
    // Spec 09.2: last key, like the schema.
    sectionId: r.sectionId as RoutineItem["sectionId"],
  };
}

export function toRoutineSectionDto(r: RoutineSectionRecord): RoutineSection {
  return { id: r.id as RoutineSection["id"], position: r.position, name: r.name, notes: r.notes };
}

/** Keys in `RoutineSchema` order: `JSON.stringify` of this IS the wire bytes
 * the ETag hashes (the Zod serializer has no transforms on this shape). */
export function toRoutineDto(r: RoutineRecord): Routine {
  return {
    id: r.id as Routine["id"],
    name: r.name,
    notes: r.notes,
    sections: r.sections.map(toRoutineSectionDto),
    items: r.items.map(toRoutineItemDto),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    oneOffUntil: r.oneOffUntil?.toISOString() ?? null,
  };
}

/** DB record -> wire DTO, keys in `WorkoutSchema` field order (§5). */
export function toWorkoutDto(r: WorkoutRecord): Workout {
  return {
    id: r.id as Workout["id"],
    title: r.title,
    notes: r.notes,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    localDate: r.localDate,
    tzOffsetMinutes: r.tzOffsetMinutes,
    clientGeneratedId: r.clientGeneratedId,
    source: r.source as Workout["source"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    routineName: r.routineName,
    plannedDurationSeconds: r.plannedDurationS,
  };
}

export function toWorkoutExerciseDto(r: WorkoutExerciseRecord): WorkoutExercise {
  return {
    id: r.id as WorkoutExercise["id"],
    workoutId: r.workoutId as WorkoutExercise["workoutId"],
    position: r.position,
    exerciseId: r.exerciseId as WorkoutExercise["exerciseId"],
    exerciseNameSnapshot: r.exerciseNameSnapshot,
    modalitySnapshot: r.modalitySnapshot as WorkoutExercise["modalitySnapshot"],
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    targetSets: r.targetSets,
    targetRepsLow: r.targetRepsLow,
    targetRepsHigh: r.targetRepsHigh,
    // Spec 09 D5: the one tenths → decimal conversion on the read side.
    targetRpe: r.targetRpeTenths === null ? null : tenthsToRpe(r.targetRpeTenths),
    restSeconds: r.restSeconds,
    supersetGroup: r.supersetGroup,
    // Spec 09.1: key order matches `PlannedSetSchema`.
    plannedSets: r.plannedSets.map((s) => ({ ...s })),
    // Spec 09.2: last key, after plannedSets.
    sectionId: r.sectionId as WorkoutExercise["sectionId"],
  };
}

export function toWorkoutSectionDto(r: WorkoutSectionRecord): WorkoutSection {
  return { id: r.id as WorkoutSection["id"], position: r.position, name: r.name, notes: r.notes, addedInWorkout: r.addedInWorkout };
}

/** DB record -> wire DTO, keys in `SetEntrySchema` field order. */
export function toSetEntryDto(r: SetEntryRecord): SetEntry {
  return {
    id: r.id as SetEntry["id"],
    workoutExerciseId: r.workoutExerciseId as SetEntry["workoutExerciseId"],
    clientGeneratedId: r.clientGeneratedId,
    setNumber: r.setNumber,
    setType: r.setType as SetEntry["setType"],
    reps: r.reps,
    weight: r.weight,
    weightUnit: r.weightUnit as SetEntry["weightUnit"],
    weightKg: r.weightKg,
    distance: r.distance,
    distanceUnit: r.distanceUnit as SetEntry["distanceUnit"],
    distanceM: r.distanceM,
    durationS: r.durationS,
    calories: r.calories,
    rpe: r.rpe,
    isComplete: r.isComplete,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toWorkoutDetailDto(r: WorkoutDetailRecord): WorkoutDetail {
  return {
    ...toWorkoutDto(r),
    exercises: r.exercises.map(
      (e): WorkoutExerciseDetail => ({ ...toWorkoutExerciseDto(e), sets: e.sets.map(toSetEntryDto) }),
    ),
    routineNotes: r.routineNotes,
    sections: r.sections.map(toWorkoutSectionDto),
    routineIsOneOff: r.routineIsOneOff,
  };
}

/** Spec 19.0 §5.2: a pair as every read shows it (the mapping `GET` and the account export, AC35). */
export function toHevyPairDto(p: HevyPair): HevyPair {
  return {
    hevyTemplateId: p.hevyTemplateId,
    hevyTitle: p.hevyTitle,
    hevyType: p.hevyType,
    role: p.role,
    exerciseId: p.exerciseId,
    exerciseActive: p.exerciseActive,
    measureRule: p.measureRule,
    exportAs: p.exportAs,
  };
}

export function toHevySectionRuleDto(r: HevySectionRule): HevySectionRule {
  return { name: r.name, treatment: r.treatment };
}

/** Spec 19.0 §5.6: one link in the account export. */
export function toHevyExportLinkDto(l: HevyExportLinkRecord): HevyExportLink {
  return { workoutId: l.workoutId, hevyWorkoutId: l.hevyWorkoutId, origin: l.origin, syncedAt: l.syncedAt?.toISOString() ?? null };
}
