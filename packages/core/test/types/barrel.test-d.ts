import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
// Named imports from the barrel ARE the assertion: if src/index.ts stops
// re-exporting any of these, `vitest --typecheck` fails here — no hardcoded
// name list to drift out of sync with check-exports.mjs.
import {
  type CodeCount,
  type DuplicateSide,
  type HEVY_IMPORT_DROP_CODES,
  type HEVY_IMPORT_NOTICE_CODES,
  type HEVY_IMPORT_OUTCOME_VALUES,
  type HEVY_ROUTINE_NOTICE_CODES,
  type HevyImportBatch,
  type HevyImportContext,
  type HevyImportDropCode,
  type HevyImportNoticeCode,
  type HevyImportOutcome,
  type HevyImportResult,
  type HevyRoutineNoticeCode,
  type HevyRoutineTranslation,
  type HevyWorkoutTranslation,
  type ImportedWorkout,
  type ImportedWorkoutSet,
  type ImportExerciseInfo,
  type RoutineWrite,
  type CreateExercise,
  assignSupersets,
  cutCodePoints,
  exerciseFromHevyTemplate,
  hevyWeightFromKg,
  isDuplicateWorkout,
  titleKey,
  translateHevyRoutine,
  translateHevyWorkout,
  HEVY_LINK_ORIGIN_VALUES,
  type HEVY_RPE_STEPS,
  HEVY_SET_TYPE_VALUES,
  type HEVY_TYPE_VALUES,
  MEASURE_RULE_VALUES,
  type PAIR_ROLE_VALUES,
  type SECTION_TREATMENT_VALUES,
  type HevyLinkOrigin,
  type HevyRpe,
  type HevySetType,
  type HevyType,
  type MeasureRule,
  type PairRole,
  type SectionTreatment,
  type WorkoutSource,
  brandId,
  SetEntryIdSchema,
  parseSetEntryId,
  isSetEntryId,
  MEASURE_NAMES,
  requiredMeasuresFor,
  forbiddenMeasuresFor,
  SET_REPS_MAX,
  SET_WEIGHT_MAX,
  SET_DISTANCE_MAX,
  SET_DURATION_S_MAX,
  SET_CALORIES_MAX,
  SetEntrySchema,
  CreateSetSchema,
  UpdateSetSchema,
  WorkoutExerciseDetailSchema,
  CatalogName,
  CatalogSinceQuery,
  DISTANCE_UNIT_VALUES,
  EquipmentSchema,
  ExerciseIdSchema,
  ExerciseSchema,
  ExercisesResponse,
  isExerciseId,
  isSyncToken,
  isUserId,
  KM_TO_M,
  kgToLb,
  kmToM,
  LB_TO_KG,
  MeSchema,
  MI_TO_M,
  FT_TO_M,
  MODALITY_VALUES,
  MuscleGroupSchema,
  mToKm,
  mToMi,
  ftToM,
  mToFt,
  parseDecimalMilli,
  RECORD_MEASURES_BY_MODALITY,
  modalitiesCompatible,
  compatibleModalities,
  canChangeModality,
  lineageRootId,
  ExerciseRoutinesResponseSchema,
  ExerciseUsageResponseSchema,
  type ExerciseUsage,
  type ExerciseRoutineRef,
  miToM,
  lbToKg,
  noControlChars,
  parseExerciseId,
  parseUserId,
  RECORD_TYPE_VALUES,
  RECORD_UNIT_VALUES,
  SET_TYPE_VALUES,
  toCanonicalKg,
  toCanonicalMeters,
  UNIT_PREFERENCE_VALUES,
  UpdateMeSchema,
  UserIdSchema,
  WEIGHT_UNIT_VALUES,
  type Equipment,
  type Exercise,
  type ExerciseId,
  type Me,
  type Modality,
  type MuscleGroup,
  type RecordType,
  type RecordUnit,
  type PersonalRecord,
  type SetType,
  type UnitPreference,
  type UpdateMeInput,
  type UserId,
  type WeightUnit,
} from "../../src/index.js";
import type { PreparedCatalog ,
  SectionScoreSchema,
  TimedSectionSummarySchema} from "../../src/index.js";
import {
  scoreKindOf,
  sectionTimerOf,
  type ScoreKind,
  describeTimer,
  formatClock,
  hevyTimerDurationSeconds,
  hevyTimerLine,
  type TimedSectionData,
  resultIssues,
  roundTimeIssues,
  scoreText,
  sectionScore,
  timerFitsRecorded,
  groupRangeRule,
  timedGroupRange,
  planSessionChange,
  type SessionOp,
  type SessionPlan,
  type SessionSlot,
  type TimedSectionSummary,
  TIMER_FORMAT_VALUES,
  TIMER_ISSUE_CODES,
  type RoundTime,
  type SectionResult,
  type SectionScore,
  type SectionTimer,
  type SectionTimerInput,
  type SetSectionResult,
  type TimerFormat,
  type TimerIssue,
  type TimerIssueCode,
} from "../../src/index.js";

describe("09.5 — timed-section exports", () => {
  it("pins the literal tuples and the helper signatures", () => {
    expectTypeOf(TIMER_FORMAT_VALUES).toEqualTypeOf<readonly ["set_timer", "amrap", "time_cap"]>();
    expectTypeOf<TimerFormat>().toEqualTypeOf<"set_timer" | "amrap" | "time_cap">();
    expectTypeOf<TimerIssueCode>().toEqualTypeOf<(typeof TIMER_ISSUE_CODES)[number]>();
    expectTypeOf(TIMER_ISSUE_CODES[0]).toEqualTypeOf<"round_beyond_rounds">();
    expectTypeOf<TimerIssue>().toEqualTypeOf<{ path: string; code: TimerIssueCode; message: string }>();
    expectTypeOf<SectionTimer["format"]>().toEqualTypeOf<TimerFormat>();
    expectTypeOf<Extract<SectionTimer, { format: "time_cap" }>["capSeconds"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Extract<SectionTimerInput, { format: "time_cap" }>["capSeconds"]>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<SectionResult>().toEqualTypeOf<{ rounds: number | null; reps: number | null; finishSeconds: number | null; capped: boolean }>();
    expectTypeOf<RoundTime>().toEqualTypeOf<{ round: number; seconds: number }>();
    expectTypeOf<SetSectionResult>().not.toBeAny();
    expectTypeOf<SectionScore["kind"]>().toEqualTypeOf<"total_time" | "rounds_reps" | "finish_time" | "capped">();
    expectTypeOf(formatClock).toEqualTypeOf<(seconds: number) => string>();
    expectTypeOf(describeTimer).toEqualTypeOf<(timer: SectionTimer) => string>();
    expectTypeOf(scoreText).toEqualTypeOf<(score: SectionScore) => string>();
    expectTypeOf(sectionScore).returns.toEqualTypeOf<SectionScore | null>();
    expectTypeOf(roundTimeIssues).returns.toEqualTypeOf<TimerIssue[]>();
    expectTypeOf(resultIssues).returns.toEqualTypeOf<TimerIssue[]>();
    expectTypeOf(timerFitsRecorded).returns.toEqualTypeOf<TimerIssue[]>();
    // Spec 10.7 AC12 — a timed section's grouping rules and the widened session op.
    expectTypeOf(groupRangeRule).toEqualTypeOf<(slots: readonly SessionSlot[], from: number, to: number) => { slots: SessionSlot[]; capped: boolean }>();
    expectTypeOf(timedGroupRange).returns.toEqualTypeOf<{ from: number; to: number } | null>();
    expectTypeOf<Extract<SessionOp, { type: "groupRange" }>>().toEqualTypeOf<{ readonly type: "groupRange"; readonly from: number; readonly to: number }>();
    expectTypeOf<Extract<SessionPlan, { ok: true }>["capped"]>().toEqualTypeOf<true | undefined>();
    expectTypeOf(planSessionChange).parameter(1).toEqualTypeOf<SessionOp>();
    // Spec 09.5 Phase B — the History score schema and the Phase A type must not drift.
    expectTypeOf<z.infer<typeof SectionScoreSchema>>().toEqualTypeOf<SectionScore>();
    expectTypeOf<z.infer<typeof TimedSectionSummarySchema>>().toEqualTypeOf<TimedSectionSummary>();
    expectTypeOf<TimedSectionSummary["timer"]>().toEqualTypeOf<SectionTimer>();
    // Spec 09.5 Phase C — the Hevy timer line and marker duration.
    expectTypeOf(hevyTimerLine).toEqualTypeOf<(s: TimedSectionData) => string>();
    expectTypeOf(hevyTimerDurationSeconds).toEqualTypeOf<(s: TimedSectionData) => number | null>();
    expectTypeOf<TimedSectionData["timer"]>().toEqualTypeOf<SectionTimer>();
    // Spec 10.7 Phase D — the reader's score kind and timer rules.
    expectTypeOf<ScoreKind>().toEqualTypeOf<"time" | "rounds-reps" | "other">();
    expectTypeOf(scoreKindOf).returns.toEqualTypeOf<ScoreKind | null>();
    expectTypeOf(sectionTimerOf).returns.toEqualTypeOf<SectionTimer | null>();
  });
});

describe("barrel — src/index.ts re-exports the whole stable surface", () => {
  it("value exports resolve", () => {
    expectTypeOf(SetEntryIdSchema).not.toBeAny();
    expectTypeOf(parseSetEntryId).not.toBeAny();
    expectTypeOf(isSetEntryId).not.toBeAny();
    expectTypeOf(MEASURE_NAMES).not.toBeAny();
    expectTypeOf(requiredMeasuresFor).not.toBeAny();
    expectTypeOf(forbiddenMeasuresFor).not.toBeAny();
    expectTypeOf(SET_REPS_MAX).not.toBeAny();
    expectTypeOf(SET_WEIGHT_MAX).not.toBeAny();
    expectTypeOf(SET_DISTANCE_MAX).not.toBeAny();
    expectTypeOf(SET_DURATION_S_MAX).not.toBeAny();
    expectTypeOf(SET_CALORIES_MAX).not.toBeAny();
    expectTypeOf(SetEntrySchema).not.toBeAny();
    expectTypeOf(CreateSetSchema).not.toBeAny();
    expectTypeOf(UpdateSetSchema).not.toBeAny();
    expectTypeOf(WorkoutExerciseDetailSchema).not.toBeAny();
    expectTypeOf(toCanonicalKg).toBeFunction();
    expectTypeOf(toCanonicalMeters).toBeFunction();
    expectTypeOf(brandId).toBeFunction();
    expectTypeOf(parseUserId).toBeFunction();
    expectTypeOf(isUserId).toBeFunction();
    expectTypeOf(kgToLb).toBeFunction();
    expectTypeOf(lbToKg).toBeFunction();
    expectTypeOf(kmToM).toBeFunction();
    expectTypeOf(mToKm).toBeFunction();
    expectTypeOf(miToM).toBeFunction();
    expectTypeOf(mToMi).toBeFunction();
    expectTypeOf(ftToM).toBeFunction();
    expectTypeOf(mToFt).toBeFunction();
    expectTypeOf(RECORD_MEASURES_BY_MODALITY.calories).toEqualTypeOf<readonly ("reps" | "weight" | "distance" | "duration" | "calories")[]>();
    expectTypeOf<ExerciseRoutineRef>().toEqualTypeOf<{ id: ExerciseRoutineRef["id"]; name: string; oneOffUntil: string | null }>();
    expectTypeOf(ExerciseRoutinesResponseSchema.parse).toBeFunction();
    expectTypeOf<ExerciseUsage["lastLoggedOn"]>().toEqualTypeOf<string>();
    expectTypeOf(ExerciseUsageResponseSchema.parse).toBeFunction();
    expectTypeOf(modalitiesCompatible).toBeFunction();
    expectTypeOf(compatibleModalities).toBeFunction();
    expectTypeOf(canChangeModality).toBeFunction();
    expectTypeOf(lineageRootId).toEqualTypeOf<(e: { id: string; forkedFromExerciseId: string | null }) => string>();
    expectTypeOf(parseDecimalMilli).toEqualTypeOf<(decimalString: string) => number>();
    expectTypeOf(LB_TO_KG).toBeNumber();
    expectTypeOf(KM_TO_M).toBeNumber();
    expectTypeOf(MI_TO_M).toBeNumber();
    expectTypeOf(FT_TO_M).toBeNumber();
    expectTypeOf(UNIT_PREFERENCE_VALUES).toEqualTypeOf<readonly ["kg", "lb"]>();
    expectTypeOf(WEIGHT_UNIT_VALUES).toEqualTypeOf<readonly ["kg", "lb"]>();
    expectTypeOf(DISTANCE_UNIT_VALUES).toEqualTypeOf<readonly ["m", "km", "mi", "ft"]>();
    expectTypeOf(MODALITY_VALUES).items.toBeString();
    expectTypeOf(SET_TYPE_VALUES).items.toBeString();
    expectTypeOf(RECORD_TYPE_VALUES).items.toBeString();
    expectTypeOf(MeSchema).not.toBeAny();
    expectTypeOf(UpdateMeSchema).not.toBeAny();
    expectTypeOf(UserIdSchema).not.toBeAny();
    expectTypeOf(noControlChars).toBeFunction();
    expectTypeOf(parseExerciseId).toBeFunction();
    expectTypeOf(isExerciseId).toBeFunction();
    expectTypeOf(ExerciseIdSchema).not.toBeAny();
    expectTypeOf(CatalogName).not.toBeAny();
    expectTypeOf(ExerciseSchema).not.toBeAny();
    expectTypeOf(MuscleGroupSchema).not.toBeAny();
    expectTypeOf(EquipmentSchema).not.toBeAny();
    expectTypeOf(ExercisesResponse).not.toBeAny();
    expectTypeOf(CatalogSinceQuery).not.toBeAny();
    expectTypeOf(isSyncToken).toBeFunction();
  });

  it("type exports resolve", () => {
    expectTypeOf<Me>().not.toBeAny();
    expectTypeOf<UpdateMeInput>().not.toBeAny();
    expectTypeOf<UserId>().toMatchTypeOf<string>();
    expectTypeOf<UnitPreference>().toEqualTypeOf<"kg" | "lb">();
    expectTypeOf<WeightUnit>().toEqualTypeOf<"kg" | "lb">();
    expectTypeOf<Modality>().toBeString();
    expectTypeOf<SetType>().toBeString();
    expectTypeOf<RecordType>().toBeString();
    expectTypeOf(RECORD_UNIT_VALUES).items.toBeString();
    expectTypeOf<RecordUnit>().toBeString();
    expectTypeOf<PersonalRecord["value"]>().toBeNumber();
    expectTypeOf<Exercise>().not.toBeAny();
    expectTypeOf<MuscleGroup>().not.toBeAny();
    expectTypeOf<Equipment>().not.toBeAny();
    expectTypeOf<ExerciseId>().toMatchTypeOf<string>();
  });

  it("19.0 AC1 / AC2 — the Hevy vocabulary tuples and the widened source", () => {
    expectTypeOf<WorkoutSource>().toEqualTypeOf<"manual" | "hevy">();
    expectTypeOf<HevyType>().toEqualTypeOf<(typeof HEVY_TYPE_VALUES)[number]>();
    expectTypeOf<HevySetType>().toEqualTypeOf<"warmup" | "normal" | "failure" | "dropset">();
    expectTypeOf<HevyRpe>().toEqualTypeOf<(typeof HEVY_RPE_STEPS)[number]>();
    expectTypeOf<MeasureRule>().toEqualTypeOf<"calories_as_reps" | "assist_weight_ignored">();
    expectTypeOf<PairRole>().toEqualTypeOf<(typeof PAIR_ROLE_VALUES)[number]>();
    expectTypeOf<SectionTreatment>().toEqualTypeOf<(typeof SECTION_TREATMENT_VALUES)[number]>();
    expectTypeOf<HevyLinkOrigin>().toEqualTypeOf<"sent" | "imported" | "matched">();
    expectTypeOf(HEVY_SET_TYPE_VALUES).items.toBeString();
    expectTypeOf(MEASURE_RULE_VALUES).items.toBeString();
    expectTypeOf(HEVY_LINK_ORIGIN_VALUES).items.toBeString();
  });

  it("19.1 AC14 — the Hevy import surface", () => {
    expectTypeOf<HevyImportOutcome>().toEqualTypeOf<(typeof HEVY_IMPORT_OUTCOME_VALUES)[number]>();
    expectTypeOf<HevyImportDropCode>().toEqualTypeOf<(typeof HEVY_IMPORT_DROP_CODES)[number]>();
    expectTypeOf<HevyImportNoticeCode>().toEqualTypeOf<(typeof HEVY_IMPORT_NOTICE_CODES)[number]>();
    expectTypeOf<HevyRoutineNoticeCode>().toEqualTypeOf<(typeof HEVY_ROUTINE_NOTICE_CODES)[number]>();
    expectTypeOf<HevyImportResult["drops"]>().toEqualTypeOf<CodeCount<HevyImportDropCode>[]>();
    expectTypeOf<HevyImportBatch["workouts"]>().not.toBeAny();
    expectTypeOf(translateHevyWorkout).returns.toEqualTypeOf<HevyWorkoutTranslation>();
    expectTypeOf(translateHevyWorkout).parameter(1).toEqualTypeOf<HevyImportContext>();
    expectTypeOf<HevyImportContext["exercises"]>().toEqualTypeOf<ReadonlyMap<string, ImportExerciseInfo>>();
    expectTypeOf<ImportedWorkout["exercises"][number]["sets"][number]>().toEqualTypeOf<ImportedWorkoutSet>();
    expectTypeOf(translateHevyRoutine).returns.toEqualTypeOf<HevyRoutineTranslation>();
    expectTypeOf<Extract<HevyRoutineTranslation, { ok: true }>["input"]>().toEqualTypeOf<RoutineWrite>();
    expectTypeOf(exerciseFromHevyTemplate).returns.toEqualTypeOf<{ input: CreateExercise; suggestedRule: MeasureRule | null } | null>();
    expectTypeOf(isDuplicateWorkout).parameters.toEqualTypeOf<[DuplicateSide, DuplicateSide]>();
    expectTypeOf(titleKey).returns.toEqualTypeOf<string | null>();
    expectTypeOf(cutCodePoints).returns.toEqualTypeOf<{ text: string; cut: boolean }>();
    expectTypeOf(hevyWeightFromKg).returns.toBeNumber();
    expectTypeOf(assignSupersets<number>).returns.toEqualTypeOf<{ groups: (number | null)[]; overLimit: number; cut: number }>();
  });
});

describe("Minor 221 — a prepared catalog is nominal", () => {
  it("a plain object is not a PreparedCatalog", () => {
    // @ts-expect-error a plain object is not a PreparedCatalog: only prepareCatalog makes one
    const c: PreparedCatalog<{ id: string; name: string; ownerUserId: string | null }> = { entries: [] };
    expectTypeOf(c).not.toBeNever();
  });
});
