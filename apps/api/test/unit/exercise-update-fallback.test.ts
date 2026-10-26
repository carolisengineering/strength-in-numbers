import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { ExerciseRetiredError, ExerciseTypeLockedError, InternalError } from "../../src/errors/app-error.js";

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

/**
 * Spec 03.4 AC15 — the type rule is a NOT EXISTS on the same UPDATE. When that UPDATE matches nothing, the recheck
 * names the cause: the row was retired, the lineage now has sets, or neither (a set vanished in the gap) — then the
 * statement runs once more, and a second miss is the invariant break.
 */
function repoForTypeChange(opts: { recheckActive: boolean; probe: boolean }) {
  let reads = 0;
  const statements: string[] = [];
  // The full text, nested fragments included: the type rule is a Prisma.sql fragment inside the UPDATE.
  const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = Prisma.sql(strings, ...values).sql.replace(/\$\d+/g, "?");
    statements.push(sql);
    if (/^\s*UPDATE "exercise"/.test(sql)) return [];
    // The probe names "exercise" too (the lineage), so it is matched first.
    if (/set_entry/.test(sql)) return [{ has_sets: opts.probe }];
    if (/FROM "exercise"\s+WHERE id = \?::uuid/.test(sql)) return reads++ === 0 ? [ownedRow(true)] : [ownedRow(opts.recheckActive)];
    throw new Error(`unexpected statement: ${sql}`);
  });
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
  return { repo: createExerciseRepository(prisma), statements };
}
const updates = (statements: string[]) => statements.filter((s) => /^\s*UPDATE "exercise"/.test(s));

describe("03.4 AC15 — atomic, with a recheck", () => {
  it("(a) the row is active and the lineage has sets: ExerciseTypeLockedError", async () => {
    const { repo, statements } = repoForTypeChange({ recheckActive: true, probe: true });
    await expect(repo.updateExercise(USER, ID, { modality: "duration" })).rejects.toBeInstanceOf(ExerciseTypeLockedError);
    expect(updates(statements)).toHaveLength(1);
    expect(updates(statements)[0]).toMatch(/NOT EXISTS/);
  });
  it("(b) the row was retired: ExerciseRetiredError", async () => {
    const { repo } = repoForTypeChange({ recheckActive: false, probe: true });
    await expect(repo.updateExercise(USER, ID, { modality: "duration" })).rejects.toBeInstanceOf(ExerciseRetiredError);
  });
  it("(c) neither: the UPDATE runs once more, and a second miss is InternalError; no advisory lock anywhere", async () => {
    const { repo, statements } = repoForTypeChange({ recheckActive: true, probe: false });
    await expect(repo.updateExercise(USER, ID, { modality: "duration" })).rejects.toBeInstanceOf(InternalError);
    expect(updates(statements)).toHaveLength(2);
    expect(statements.some((s) => /pg_advisory/.test(s))).toBe(false);
  });
});

describe("03.4 AC4 — the problem type", () => {
  it("409 exercise-type-locked with a fixed detail that names no modality", () => {
    const e = new ExerciseTypeLockedError("duration", "calories");
    expect([e.status, e.slug, e.title]).toEqual([409, "exercise-type-locked", "Exercise type locked"]);
    expect(e.publicDetail).toBe(
      "This exercise already has logged sets, so its type can only change to one that logs the same measures. Create a new exercise instead.",
    );
    expect([e.fromModality, e.toModality]).toEqual(["duration", "calories"]);
    const exposed = JSON.stringify({ detail: e.publicDetail, title: e.title, message: e.message });
    expect(exposed).not.toMatch(/duration|calories/);
  });
});
