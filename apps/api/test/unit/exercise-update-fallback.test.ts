import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { ExerciseRetiredError, InternalError } from "../../src/errors/app-error.js";

/**
 * #24 — `updateExercise`'s zero-row fallback. The gated UPDATE matches no row only if the row changed under the
 * request; ownership cannot change, so the one honest reason is a concurrent retire (409 exercise-retired). A
 * still-owned, still-active row means an invariant broke, which must surface as a 500, never as "use fork" advice.
 */

const USER = "018f4e8a-1c2d-7f3a-8b6c-9d0e1f2a3b4c";
const ID = "018f4e8a-1c2d-7f3a-8b6c-9d0e1f2a3b4d";

const ownedRow = (isActive: boolean) => ({
  id: ID,
  catalog_key: null,
  owner_user_id: USER,
  name: "Cable Fly",
  modality: "weight_reps",
  primary_muscle_id: null,
  secondary_muscle_ids: [],
  equipment_id: null,
  is_active: isActive,
  forked_from_exercise_id: null,
  created_at: new Date(0),
  updated_at: new Date(0),
});

/**
 * Answers by statement, not by call order: the gated UPDATE matches no row; the first visibility read sees the
 * owned, active row and every later one sees `recheck`. Any other statement fails the test.
 */
function repoWhereUpdateMatchesNothing(recheck: unknown[]) {
  let reads = 0;
  const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (/^\s*UPDATE "exercise"/.test(sql)) return [];
    if (/FROM "exercise"\s+WHERE id = \?::uuid/.test(sql)) return reads++ === 0 ? [ownedRow(true)] : recheck;
    throw new Error(`unexpected statement: ${sql}`);
  });
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
  return { repo: createExerciseRepository(prisma), queryRaw };
}

describe("#24 — updateExercise's zero-row fallback", () => {
  it("a row retired between the read and the UPDATE is 409 exercise-retired", async () => {
    const { repo } = repoWhereUpdateMatchesNothing([ownedRow(false)]);
    await expect(repo.updateExercise(USER, ID, { name: "New" })).rejects.toBeInstanceOf(ExerciseRetiredError);
  });

  it("a row still owned and active is an invariant break: InternalError (500), not exercise-immutable-use-fork", async () => {
    const { repo } = repoWhereUpdateMatchesNothing([ownedRow(true)]);
    const error = await repo.updateExercise(USER, ID, { name: "New" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InternalError);
    expect((error as InternalError).status).toBe(500);
  });
});
