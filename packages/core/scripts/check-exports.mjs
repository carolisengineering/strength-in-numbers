#!/usr/bin/env node
/**
 * Post-build smoke (Spec 02 §2 AC1). Reads the package `exports` map and checks,
 * for the compiled `dist/`, that:
 *   - the `import` target loads and exposes the whole stable surface (§3);
 *   - the `types` target exists and is non-empty.
 * Runs as the second half of `pnpm --filter @sin/core build`, so a broken barrel,
 * a missing `.js` extension, or a `types` condition pointing at nothing fails the
 * build instead of a downstream consumer. Full consumer-side resolution (Node
 * conditions, `bundler` moduleResolution) is exercised for real once `apps/web`
 * imports `@sin/core` in Spec 04.
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const root = pkg.exports["."];

function fail(msg) {
  console.error(`check-exports FAILED — ${msg}`);
  process.exit(1);
}

// --- types condition ---
if (!root.types) fail('package.json exports["."] has no "types" condition');
const typesUrl = new URL("../" + root.types, import.meta.url);
try {
  if (statSync(typesUrl).size === 0) fail(`${fileURLToPath(typesUrl)} is empty`);
} catch {
  fail(`types target ${fileURLToPath(typesUrl)} does not exist`);
}

// --- import condition ---
const importTarget = root.import ?? root.default;
if (!importTarget) fail('package.json exports["."] has no "import"/"default" condition');
const entry = new URL("../" + importTarget, import.meta.url);
const mod = await import(entry.href);

const EXPECTED = [
  // enums
  "UNIT_PREFERENCE_VALUES",
  "WEIGHT_UNIT_VALUES",
  "DISTANCE_UNIT_VALUES",
  "MODALITY_VALUES",
  "SET_TYPE_VALUES",
  "RECORD_TYPE_VALUES",
  "RECORD_UNIT_VALUES",
  "RECORD_UNIT_BY_TYPE",
  // ids
  "brandId",
  "UserIdSchema",
  "parseUserId",
  "isUserId",
  "ExerciseIdSchema",
  "parseExerciseId",
  "isExerciseId",
  // units
  "LB_TO_KG",
  "KM_TO_M",
  "MI_TO_M",
  "FT_TO_M",
  "toCanonicalKg",
  "toCanonicalMeters",
  "kgToLb",
  "lbToKg",
  "kmToM",
  "mToKm",
  "miToM",
  "mToMi",
  "ftToM",
  "mToFt",
  // dto — me
  "MeSchema",
  "UpdateMeSchema",
  // dto — exercise catalog (Spec 03.1)
  "noControlChars",
  "CatalogName",
  "ExerciseSchema",
  "ReferenceRowSchema",
  "MuscleGroupSchema",
  "EquipmentSchema",
  "ExercisesResponse",
  "CatalogSinceQuery",
  "isSyncToken",
  "MuscleGroupsResponse",
  "EquipmentResponse",
  // ids — workout (Spec 05.0 §5)
  "WorkoutIdSchema",
  "parseWorkoutId",
  "isWorkoutId",
  "WorkoutExerciseIdSchema",
  "parseWorkoutExerciseId",
  "isWorkoutExerciseId",
  // enums — workout (Spec 05.0 §5)
  "WORKOUT_SOURCE_VALUES",
  // dto — workout (Spec 05.0 §5)
  "noControlCharsExceptWhitespace",
  "WORKOUT_TITLE_MAX",
  "WORKOUT_NOTES_MAX",
  "WORKOUT_FUTURE_SKEW_MAX_MS",
  "WORKOUT_STARTED_AT_PAST_MAX_MS",
  "WORKOUT_DURATION_MAX_S",
  "WORKOUT_START_EDIT_FLOOR",
  "REQUIRES_START",
  "NOT_WITH_ENDED_AT",
  "REQUIRES_FINISH",
  // workout-retime.ts (Spec 07.4 §6.4)
  "resolveRetime",
  "RETIME_MESSAGES",
  "WorkoutSchema",
  "WorkoutExerciseSchema",
  "WorkoutDetailSchema",
  "CreateWorkoutSchema",
  "UpdateWorkoutSchema",
  "AddWorkoutExerciseSchema",
  "UpdateWorkoutExerciseSchema",
  // time.ts (Spec 05.0 §5)
  "localDateFor",
  "offsetMinutesForZone",
  "clampInstantToSpan",
  // ids — set entry (Spec 05.1 §5)
  "SetEntryIdSchema",
  "parseSetEntryId",
  "isSetEntryId",
  // dto — set entry (Spec 05.1 §5, D11, D12)
  "MEASURE_NAMES",
  "requiredMeasuresFor",
  "forbiddenMeasuresFor",
  "SET_REPS_MAX",
  "SET_WEIGHT_MAX",
  "SET_DISTANCE_MAX",
  "SET_DURATION_S_MAX",
  "SET_CALORIES_MAX",
  "SetEntrySchema",
  "CreateSetSchema",
  "UpdateSetSchema",
  "WorkoutExerciseDetailSchema",
  // dto — personal records (Spec 07.0 §5)
  "PersonalRecordSchema",
  "PersonalRecordsQuerySchema",
  "PersonalRecordsResponseSchema",
  "UpdatedWorkoutSchema",
  // records.ts (Spec 07.0 §6.1)
  "parseWeightKgMilli",
  "parseDecimalMilli",
  "milliToDecimalString",
  "estimate1rm",
  "computeRecords",
  "setVolumeMilli",
  "sumVolumeMilli",
  "setRecordValueMilli",
  "progressPoints",
  "setChangeAffectsRecords",
  "RECORD_MEASURES_BY_MODALITY",
  // dto/exercise-reads.ts (Spec 03.4 §5.1–§5.2)
  "ExerciseRoutineRefSchema",
  "ExerciseRoutinesResponseSchema",
  "ExerciseUsageSchema",
  "ExerciseUsageResponseSchema",
  // modality-change.ts (Spec 03.4 §6.1)
  "modalitiesCompatible",
  "compatibleModalities",
  "canChangeModality",
  "lineageRootId",
  // dto — progress series (Spec 07.2 §5)
  "ProgressPointSchema",
  "ProgressSeriesSchema",
  "ProgressQuerySchema",
  // dto — workout history (Spec 07.1 §5)
  "WORKOUT_HISTORY_LIMIT_DEFAULT",
  "WORKOUT_HISTORY_LIMIT_MAX",
  "WORKOUT_SUMMARY_NAMES_MAX",
  "WorkoutSummarySchema",
  "WorkoutHistoryQuerySchema",
  "WorkoutHistoryResponseSchema",
  // ids (Spec 09)
  "RoutineIdSchema",
  "parseRoutineId",
  "isRoutineId",
  "RoutineItemIdSchema",
  "parseRoutineItemId",
  "isRoutineItemId",
  "RoutineSectionIdSchema",
  "WorkoutSectionIdSchema",
  "ROUTINE_SECTIONS_MAX",
  "SECTION_NAME_MAX",
  "SECTION_NOTES_MAX",
  "SECTION_KEY_PATTERN",
  "RoutineSectionInputSchema",
  "sectionOrderViolations",
  "sectionSpanViolations",
  "groupBySection",
  // workout sections (Spec 09.4 §5)
  "SectionNameSchema",
  "SectionNotesSchema",
  "CreateWorkoutSectionSchema",
  "UpdateWorkoutSectionSchema",
  "sectionForNewExercise",
  "insertIndexForSection",
  "NOT_WITH_POSITION",
  // dto — routines (Spec 09 §5)
  "ROUTINE_NAME_MAX",
  "ROUTINE_NOTES_MAX",
  "ROUTINE_ITEM_NOTES_MAX",
  "ROUTINES_PER_USER_MAX",
  "ROUTINE_ITEMS_MAX",
  "SUPERSET_GROUP_MEMBERS_MAX",
  "SUPERSET_GROUP_VALUE_MAX",
  "ROUTINE_ONE_OFF_DAYS",
  "RoutineCreateSchema",
  "RoutineItemInputSchema",
  "RoutineWriteSchema",
  "RoutineItemSchema",
  "RoutineSchema",
  "RoutineListResponseSchema",
  // routines.ts (Spec 09 §5)
  "normalizeSupersetGroups",
  "rpeToTenths",
  "tenthsToRpe",
  // workoutText.ts, exerciseMatch.ts, importPlan.ts (Spec 10.4 §6.7)
  "IMPORT_TEXT_MAX",
  "CLOCK_LINE",
  "RESULTS_LINE",
  "BADGE_LINES",
  "GYM_LINES",
  "NAV_LINES",
  "HEADING_WORDS",
  "collapseLine",
  "isFurnitureLine",
  "cleanWorkoutText",
  "readWorkoutText",
  "SIMILAR_THRESHOLD",
  "HEAD_NOUN_BONUS",
  "normalizeExerciseName",
  "matchExerciseName",
  "prepareCatalog",
  "guessModality",
  "IMPORT_NOTICE_ORDER",
  "cutNote",
  "cutName",
  "buildImportPlan",
  // hevy — vocabulary (Spec 19.0 AC1)
  "HEVY_TYPE_VALUES",
  "HEVY_SET_TYPE_VALUES",
  "HEVY_RPE_STEPS",
  "MEASURE_RULE_VALUES",
  "PAIR_ROLE_VALUES",
  "SECTION_TREATMENT_VALUES",
  "HEVY_LINK_ORIGIN_VALUES",
  "HEVY_PAIRS_MAX",
  "HEVY_SECTION_RULES_MAX",
  "HEVY_LINK_CLAIM_TTL_S",
  // dto — Hevy API (Spec 19.0 AC3)
  "HEVY_MUSCLE_VALUES",
  "HEVY_EQUIPMENT_VALUES",
  "HEVY_TYPE_ALIASES",
  "readHevyType",
  "HevySetSchema",
  "HevyWorkoutExerciseSchema",
  "HevyWorkoutSchema",
  "HevyWorkoutPageSchema",
  "HevyRoutineSetSchema",
  "HevyRoutineExerciseSchema",
  "HevyRoutineSchema",
  "HevyRoutinePageSchema",
  "HevyFolderSchema",
  "HevyFolderPageSchema",
  "HevyTemplateSchema",
  "HevyTemplatePageSchema",
  "HevyUserInfoSchema",
  "HevyWorkoutCountSchema",
  "HevyCreateWorkoutReplySchema",
  "HevyUpdateWorkoutReplySchema",
  "HevyCreateTemplateReplySchema",
  "HevyCreateTemplateBodySchema",
  "HevyPostSetSchema",
  "HevyPostExerciseSchema",
  "HevyPostWorkoutSchema",
  // hevy — pairing (Spec 19.0 AC4, AC5, AC15)
  "canonicalModalityForHevyType",
  "hevyPairingProblem",
  "defaultMeasureRule",
  "hevyTypeForModality",
  // hevy — sets and RPE (Spec 19.0 AC6–AC9)
  "roundRpeForHevy",
  "roundToTenth",
  "HEVY_TO_SIN_SET_TYPE",
  "SIN_TO_HEVY_SET_TYPE",
  "SET_DROP_REASONS",
  "hevySetToSin",
  "HEVY_EXPORT_NOTICES",
  "sinSetToHevy",
  // hevy — sections (Spec 19.0 AC10)
  "SECTION_DEFAULT_RULES",
  "sectionKey",
  "sectionTreatment",
  "sectionFromPlaceholder",
  // hevy — export and fingerprint (Spec 19.0 AC11–AC13)
  "exportPairFor",
  "buildHevyWorkout",
  "HEVY_FINGERPRINT_VERSION",
  "hevyFingerprintSource",
  // hevy — mapping CSV, export-as, reference tables, HTTP DTOs (Spec 19.0 AC14, AC15, §5)
  "MAPPING_CSV_HEADER",
  "MAPPING_CSV_MAX_BYTES",
  "MAPPING_CSV_MAX_LINES",
  "MAPPING_CSV_ERROR_CODES",
  "formatMappingCsv",
  "parseMappingCsv",
  "mappingToCsvLines",
  "normalizeExportAs",
  "HEVY_MUSCLE_TO_SIN",
  "SIN_MUSCLE_TO_HEVY",
  "HEVY_EQUIPMENT_TO_SIN",
  "SIN_EQUIPMENT_TO_HEVY",
  "hevyMuscleToSin",
  "sinMuscleToHevy",
  "hevyEquipmentToSin",
  "sinEquipmentToHevy",
  "HEVY_TITLE_MAX",
  "HEVY_ID_MAX",
  "HEVY_PATCH_MAX",
  "HevyPairSchema",
  "HevyPairInputSchema",
  "HevySectionRuleSchema",
  "HevyMappingSchema",
  "HevyMappingPutSchema",
  "HevyMappingPatchSchema",
  "HevyStatusSchema",
  "HEVY_LINK_STATE_VALUES",
  "HevyLinkStateSchema",
  "HevyLinkBeginBodySchema",
  "HevyLinkBeginSchema",
  "HevyLinkCompleteSchema",
  "HevyExportLinkSchema",
  "HevyExportSchema",
  // hevy — import (Spec 19.1 AC1–AC12)
  "hevyWeightFromKg",
  "MAX_SECONDARY_MUSCLE_IDS",
  "HEVY_IMPORT_BATCH_MAX",
  "HEVY_IMPORT_EXERCISES_MAX",
  "HEVY_IMPORT_SETS_MAX",
  "HEVY_IMPORT_DESCRIPTION_MAX",
  "HEVY_IMPORT_OUTCOME_VALUES",
  "HEVY_IMPORT_DROP_CODES",
  "HEVY_IMPORT_NOTICE_CODES",
  "HEVY_ROUTINE_NOTICE_CODES",
  "HevyImportSetSchema",
  "HevyImportExerciseSchema",
  "HevyImportWorkoutSchema",
  "HevyImportBatchSchema",
  "HevyImportResultSchema",
  "HevyImportResponseSchema",
  "HevyImportFinishResponseSchema",
  "cutCodePoints",
  "assignSupersets",
  "translateHevyWorkout",
  "isDuplicateWorkout",
  "titleKey",
  "translateHevyRoutine",
  "exerciseFromHevyTemplate",
];

const missing = EXPECTED.filter((name) => !(name in mod));
if (missing.length > 0) {
  fail(
    `${fileURLToPath(entry)} is missing:\n` + missing.map((m) => "  " + m).join("\n"),
  );
}
console.log(
  `check-exports passed — types + ${EXPECTED.length} runtime exports resolve.`,
);
