import { describe, expectTypeOf, it } from "vitest";
// Named imports from the barrel ARE the assertion: if src/index.ts stops
// re-exporting any of these, `vitest --typecheck` fails here — no hardcoded
// name list to drift out of sync with check-exports.mjs.
import {
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
  MODALITY_VALUES,
  MuscleGroupSchema,
  mToKm,
  mToMi,
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
    expectTypeOf(LB_TO_KG).toBeNumber();
    expectTypeOf(KM_TO_M).toBeNumber();
    expectTypeOf(MI_TO_M).toBeNumber();
    expectTypeOf(UNIT_PREFERENCE_VALUES).toEqualTypeOf<readonly ["kg", "lb"]>();
    expectTypeOf(WEIGHT_UNIT_VALUES).toEqualTypeOf<readonly ["kg", "lb"]>();
    expectTypeOf(DISTANCE_UNIT_VALUES).toEqualTypeOf<readonly ["m", "km", "mi"]>();
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
});
