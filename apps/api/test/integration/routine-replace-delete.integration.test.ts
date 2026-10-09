import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { ExerciseRetiredError, NotFoundError, RoutineNameTakenError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";

/**
 * Spec 09 §6.3 — whole replace under a row lock (AC13, AC14) and hard delete
 * (AC15's routine half; the workout half is in workout-start-from-routine).
 */
describe.skipIf(!shouldRunIntegration())("Spec 09 — RoutineRepository replace / delete (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });

  const repo = () => createRoutineRepository(db.prisma);
  const itemCount = async (routineId: string): Promise<number> => {
    const [row] = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "routine_item" WHERE routine_id = $1::uuid`,
      routineId,
    );
    return Number(row!.n);
  };

  it("AC13 — replace swaps the whole item list: id/created_at stable, updated_at advances, every item id new, positions dense", async () => {
    const u = await insertUser(db);
    const ids = await Promise.all(Array.from({ length: 5 }, () => insertExercise(db)));
    const before = await repo().create(u, routineFixture(ids));
    const extra = await insertExercise(db);
    const after = await repo().replace(
      u,
      before.id,
      routineFixture([ids[4]!, ids[1]!, extra], { name: "Push B", notes: "changed" }),
    );
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.name).toBe("Push B");
    expect(after.notes).toBe("changed");
    expect(after.items.map((i) => [i.position, i.exerciseId])).toEqual([
      [0, ids[4]],
      [1, ids[1]],
      [2, extra],
    ]);
    const oldIds = new Set(before.items.map((i) => i.id));
    expect(after.items.some((i) => oldIds.has(i.id))).toBe(false);
    expect(await itemCount(before.id)).toBe(3);
    expect(await repo().getById(u, before.id)).toEqual(after);
  });

  it("AC13 — a failing replace leaves the routine identical; foreign/absent/malformed id is NotFoundError; a clash with another routine's name is RoutineNameTakenError; keeping its own name is fine", async () => {
    const u = await insertUser(db);
    const v = await insertUser(db);
    const ex = await insertExercise(db);
    const retired = await insertExercise(db);
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = $1::uuid`, retired);
    const a = await repo().create(u, routineFixture([ex], { name: "A" }));
    await repo().create(u, routineFixture([ex], { name: "B" }));

    await expect(repo().replace(u, a.id, routineFixture([ex, retired]))).rejects.toBeInstanceOf(ExerciseRetiredError);
    expect(await repo().getById(u, a.id)).toEqual(a);

    await expect(repo().replace(u, a.id, routineFixture([ex], { name: "b" }))).rejects.toBeInstanceOf(
      RoutineNameTakenError,
    );
    expect(await repo().getById(u, a.id)).toEqual(a);

    await expect(repo().replace(u, a.id, routineFixture([ex], { name: "A" }))).resolves.toMatchObject({ name: "A" });

    await expect(repo().replace(v, a.id, routineFixture([ex]))).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo().replace(u, uuidv7(), routineFixture([ex]))).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo().replace(u, "nope", routineFixture([ex]))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("AC14 — two concurrent replaces with distinct item lists: the stored list equals exactly one of them, never a mix, no error", async () => {
    const u = await insertUser(db);
    const [a, b, c, d] = await Promise.all([insertExercise(db), insertExercise(db), insertExercise(db), insertExercise(db)]);
    const r = await repo().create(u, routineFixture([a]));
    const left = routineFixture([b, c]);
    const right = routineFixture([d, c, b]);
    await Promise.all([repo().replace(u, r.id, left), repo().replace(u, r.id, right)]);
    const stored = (await repo().getById(u, r.id)).items.map((i) => i.exerciseId);
    expect([JSON.stringify([b, c]), JSON.stringify([d, c, b])]).toContain(JSON.stringify(stored));
    expect(await itemCount(r.id)).toBe(stored.length);
  });

  it("AC15 — delete removes the routine and its items; repeat, foreign and malformed are NotFoundError", async () => {
    const u = await insertUser(db);
    const v = await insertUser(db);
    const ex = await insertExercise(db);
    const r = await repo().create(u, routineFixture([ex, ex]));
    await expect(repo().delete(v, r.id)).rejects.toBeInstanceOf(NotFoundError);
    await repo().delete(u, r.id);
    await expect(repo().delete(u, r.id)).rejects.toBeInstanceOf(NotFoundError);
    const [n] = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "routine_item"`);
    expect(Number(n!.n)).toBe(0);
    await expect(repo().delete(u, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
