import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import {
  ExerciseRetiredError,
  NotFoundError,
  RoutineLimitError,
  RoutineNameTakenError,
  ValidationError,
} from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";

/**
 * Spec 09 §6.1–6.3 — the routine repository's create / get / list against a
 * real Postgres: the cap lock, the name index deciding a race, the batched
 * exercise check and the normalised groups.
 */
describe.skipIf(!shouldRunIntegration())("Spec 09 — RoutineRepository create / get / list (real Postgres)", () => {
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
  const countRoutines = async (userId?: string): Promise<number> => {
    const rows = userId
      ? await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "routine" WHERE user_id = $1::uuid`, userId)
      : await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "routine"`);
    return Number(rows[0]!.n);
  };

  it("AC5 — create stores items at dense positions in array order with server-generated ids and returns them by position", async () => {
    const u = await insertUser(db);
    const [a, b, c] = await Promise.all([insertExercise(db), insertExercise(db), insertExercise(db)]);
    const created = await repo().create(u, routineFixture([c, a, b]));
    expect(created.items.map((i) => [i.position, i.exerciseId])).toEqual([
      [0, c],
      [1, a],
      [2, b],
    ]);
    expect(new Set(created.items.map((i) => i.id)).size).toBe(3);
    expect(created.items[0]!.notes).toBe("first");
    const again = await repo().getById(u, created.id);
    expect(again).toEqual(created);
  });

  it("AC10 — targetRpe 8.5 is stored as tenths 85 and the record carries the tenths", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const r = await repo().create(u, routineFixture([ex]));
    const [row] = await db.prisma.$queryRawUnsafe<{ target_rpe: number }[]>(
      `SELECT target_rpe FROM "routine_item" WHERE routine_id = $1::uuid`,
      r.id,
    );
    expect(row!.target_rpe).toBe(85);
    expect(r.items[0]!.targetRpeTenths).toBe(85);
  });

  it("AC12 — superset groups are stored normalised: [7, null, 3, 7, 3] → [1, null, 2, 1, 2]", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const items = [7, null, 3, 7, 3].map((g) => ({ exerciseId: ex, supersetGroup: g }));
    const r = await repo().create(u, routineFixture([], { items }));
    expect(r.items.map((i) => i.supersetGroup)).toEqual([1, null, 2, 1, 2]);
  });

  it("AC7 — the same exercise twice is allowed and each item keeps its own targets (Review Focus 1)", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const r = await repo().create(
      u,
      routineFixture([], {
        items: [
          { exerciseId: ex, targetSets: 4, targetRepsLow: 6, targetRepsHigh: 6 },
          { exerciseId: ex, targetSets: 3, targetRepsLow: 10, targetRepsHigh: 10 },
        ],
      }),
    );
    expect(r.items.map((i) => [i.position, i.targetSets, i.targetRepsLow])).toEqual([
      [0, 4, 6],
      [1, 3, 10],
    ]);
  });

  it("AC6 — names are unique per user case-insensitively; another user may reuse one", async () => {
    const u = await insertUser(db);
    const v = await insertUser(db);
    const ex = await insertExercise(db);
    await repo().create(u, routineFixture([ex], { name: "Push A" }));
    await expect(repo().create(u, routineFixture([ex], { name: "push a" }))).rejects.toBeInstanceOf(
      RoutineNameTakenError,
    );
    await expect(repo().create(v, routineFixture([ex], { name: "PUSH A" }))).resolves.toBeDefined();
  });

  it("AC6 — 16 concurrent creates of one name: exactly one succeeds, 15 are RoutineNameTakenError, never a 500", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, () => repo().create(u, routineFixture([ex], { name: "Race" }))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(15);
    expect(rejected.map((r) => r.reason?.constructor?.name)).toEqual(Array(15).fill("RoutineNameTakenError"));
    expect(await countRoutines(u)).toBe(1);
  });

  it("AC7 — the 51st routine is RoutineLimitError; 20 concurrent creates from 45 leave exactly 50; delete frees a slot", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    for (let i = 0; i < 45; i += 1) await repo().create(u, routineFixture([ex], { name: `R${i}` }));
    const burst = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => repo().create(u, routineFixture([ex], { name: `B${i}` }))),
    );
    expect(burst.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(burst.filter((r) => r.status === "rejected" && r.reason instanceof RoutineLimitError)).toHaveLength(15);
    expect(await countRoutines(u)).toBe(50);
    await expect(repo().create(u, routineFixture([ex], { name: "Over" }))).rejects.toBeInstanceOf(RoutineLimitError);
    const list = await repo().list(u);
    await repo().delete(u, list[0]!.id);
    await expect(repo().create(u, routineFixture([ex], { name: "Over" }))).resolves.toBeDefined();
  });

  it("AC8 / AC28 — absent or another user's custom exercise → 422 on items.<i>.exerciseId; retired → ExerciseRetiredError with errors[]; missing reported before retired; nothing persisted", async () => {
    const u = await insertUser(db);
    const v = await insertUser(db);
    const ok = await insertExercise(db);
    const foreign = await insertExercise(db, { ownerUserId: v });
    const retired = await insertExercise(db);
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = $1::uuid`, retired);

    const absent = repo().create(u, routineFixture([ok, uuidv7()]));
    await expect(absent).rejects.toBeInstanceOf(ValidationError);
    await expect(absent).rejects.toMatchObject({
      fieldErrors: [{ path: "items.1.exerciseId", message: expect.any(String) }],
    });
    await expect(repo().create(u, routineFixture([foreign]))).rejects.toMatchObject({
      fieldErrors: [{ path: "items.0.exerciseId" }],
    });

    const ret = repo().create(u, routineFixture([ok, ok, retired]));
    await expect(ret).rejects.toBeInstanceOf(ExerciseRetiredError);
    await expect(ret).rejects.toMatchObject({ fieldErrors: [{ path: "items.2.exerciseId" }] });

    await expect(repo().create(u, routineFixture([retired, uuidv7()]))).rejects.toBeInstanceOf(ValidationError);

    expect(await countRoutines()).toBe(0);
  });

  it("AC2 — list returns the caller's routines ordered by lower(name) then id, items by position; a caller with none gets []", async () => {
    const u = await insertUser(db);
    const v = await insertUser(db);
    const ex = await insertExercise(db);
    for (const name of ["cherry", "Banana", "apple"]) await repo().create(u, routineFixture([ex, ex], { name }));
    await repo().create(v, routineFixture([ex], { name: "Aardvark" }));
    const mine = await repo().list(u);
    expect(mine.map((r) => r.name)).toEqual(["apple", "Banana", "cherry"]);
    expect(mine.every((r) => r.items.map((i) => i.position).join() === "0,1")).toBe(true);
    expect(await repo().list(await insertUser(db))).toEqual([]);
  });

  it("AC3 / AC28 — getById: absent, non-UUID and another user's routine all throw NotFoundError", async () => {
    const u = await insertUser(db);
    const v = await insertUser(db);
    const ex = await insertExercise(db);
    const theirs = await repo().create(v, routineFixture([ex]));
    for (const id of [uuidv7(), "nope", theirs.id]) {
      await expect(repo().getById(u, id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});
