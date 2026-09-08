import { describe, expectTypeOf, it } from "vitest";
import {
  type Equipment,
  type Exercise,
  type ExercisesResponseBody,
  type MuscleGroup,
  type UpdatedSinceQueryInput,
} from "../../src/dto/exercise.js";
import { type ExerciseId, type UserId } from "../../src/ids.js";

describe("catalog DTO types (Spec 03.1 §5)", () => {
  it("Exercise has camelCase fields with a branded id", () => {
    expectTypeOf<Exercise>().toMatchTypeOf<{
      id: ExerciseId;
      catalogKey: string | null;
      ownerUserId: UserId | null;
      name: string;
      primaryMuscleId: string | null;
      secondaryMuscleIds: string[];
      equipmentId: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>();
  });

  it("Exercise.id is the ExerciseId brand, not a plain string", () => {
    expectTypeOf<Exercise["id"]>().toEqualTypeOf<ExerciseId>();
    expectTypeOf<Exercise["id"]>().not.toEqualTypeOf<string>();
  });

  it("Exercise.modality is the closed modality union", () => {
    expectTypeOf<Exercise["modality"]>().toEqualTypeOf<
      | "weight_reps"
      | "bodyweight_reps"
      | "weighted_bodyweight"
      | "duration"
      | "distance_duration"
    >();
  });

  it("MuscleGroup and Equipment are the reference shape", () => {
    expectTypeOf<MuscleGroup>().toEqualTypeOf<{
      id: string;
      name: string;
      displayOrder: number;
    }>();
    expectTypeOf<Equipment>().toEqualTypeOf<{
      id: string;
      name: string;
      displayOrder: number;
    }>();
  });

  it("ExercisesResponseBody wraps the array plus the cursor", () => {
    expectTypeOf<ExercisesResponseBody>().toMatchTypeOf<{
      exercises: Exercise[];
      serverTime: string;
    }>();
  });

  it("UpdatedSinceQueryInput has an optional updated_since", () => {
    expectTypeOf<UpdatedSinceQueryInput>().toEqualTypeOf<{
      updated_since?: string | undefined;
    }>();
  });
});
