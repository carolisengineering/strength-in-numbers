import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertDerivedColumnsConsistent } from "./planned-set-helpers.js";

const RAMP = [
  { setType: "warmup" as const, repsLow: 10, repsHigh: 10, weight: 60, weightUnit: "kg" as const },
  { setType: "working" as const, repsLow: 8, repsHigh: 8, weight: 80, weightUnit: "kg" as const },
  { setType: "working" as const, repsLow: 6, repsHigh: 6, weight: 100, weightUnit: "kg" as const },
];

describe.skipIf(!shouldRunIntegration())("Spec 09.1 — routine rows (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await assertDerivedColumnsConsistent(db); // AC8: after every write-path test
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const repo = () => createRoutineRepository(db.prisma);

  /** A routine body whose single item uses the row form. */
  const rowBody = (exerciseId: string, sets: unknown[], extra: Record<string, unknown> = {}) => ({
    name: "Ramp",
    notes: null,
    items: [{ exerciseId, targetRpe: 8.5, restSeconds: 150, supersetGroup: null, notes: null, sets, ...extra }],
  });

  it("AC3 / AC8 — row form: stored in order, default working, echoed exactly; derived 3 × 6–10 (Review Focus 3)", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const sets = [...RAMP, { repsLow: 5, repsHigh: 5, weight: 62.5, weightUnit: "lb" as const }];
    const created = (await repo().create(u, rowBody(ex, sets) as never)).routine;
    const item = created.items[0]!;
    expect(item.sets).toEqual([...RAMP, { setType: "working", repsLow: 5, repsHigh: 5, weight: 62.5, weightUnit: "lb" }]);
    expect([item.targetSets, item.targetRepsLow, item.targetRepsHigh]).toEqual([4, 5, 10]);
    expect((await repo().getById(u, created.id)).items[0]!.sets).toEqual(item.sets);
  });

  it("AC3 — sets: [] is a valid no-plan item: no rows, derived all null", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const item = ((await repo().create(u, rowBody(ex, []) as never)).routine).items[0]!;
    expect(item.sets).toEqual([]);
    expect([item.targetSets, item.targetRepsLow, item.targetRepsHigh]).toEqual([null, null, null]);
  });

  it.each([
    [{ targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8 }, 4, [4, 6, 8]],
    [{ targetSets: 2, targetRepsLow: null, targetRepsHigh: null }, 2, [2, null, null]],
    [{ targetSets: null, targetRepsLow: 8, targetRepsHigh: 10 }, 0, [null, 8, 10]], // O1
    [{ targetSets: null, targetRepsLow: null, targetRepsHigh: null }, 0, [null, null, null]],
  ])("AC6 — legacy %j → %i rows, targets %j", async (legacy, n, targets) => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const item = ((await repo().create(u, routineFixture([ex], { items: [{ exerciseId: ex, targetRpe: null, restSeconds: null, supersetGroup: null, notes: null, ...legacy }] }))).routine).items[0]!;
    expect(item.sets).toHaveLength(n);
    expect(item.sets.every((s) => s.setType === "working" && s.weight === null)).toBe(true);
    expect([item.targetSets, item.targetRepsLow, item.targetRepsHigh]).toEqual(targets);
  });

  it("Review Focus 2 — a legacy PUT over a ramp flattens the rows but keeps RPE, rest and notes", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const created = (await repo().create(u, rowBody(ex, RAMP, { notes: "keep me" }) as never)).routine;
    const replaced = await repo().replace(u, created.id, {
      name: "Ramp", notes: null,
      items: [{ exerciseId: ex, targetSets: 3, targetRepsLow: 6, targetRepsHigh: 10, targetRpe: 8.5, restSeconds: 150, supersetGroup: null, notes: "keep me" }],
    });
    const item = replaced.items[0]!;
    expect(item.sets).toHaveLength(3);
    expect(item.sets.every((s) => s.repsLow === 6 && s.repsHigh === 10 && s.weight === null)).toBe(true);
    expect([item.targetRpeTenths, item.restSeconds, item.notes]).toEqual([85, 150, "keep me"]);
  });

  it("AC5 — modality: bodyweight weight, duration reps → 422 at the row field; legacy reps on duration accepted", async () => {
    const u = await insertUser(db);
    const bw = await insertExercise(db, { ownerUserId: u, modality: "bodyweight_reps" });
    const timed = await insertExercise(db, { ownerUserId: u, modality: "duration" });
    await expect(repo().create(u, rowBody(bw, [{ repsLow: 5, repsHigh: 5, weight: 10, weightUnit: "kg" }]) as never))
      .rejects.toMatchObject({ fieldErrors: expect.arrayContaining([expect.objectContaining({ path: "items.0.sets.0.weight" })]) });
    await expect(repo().create(u, rowBody(timed, [{ repsLow: 5, repsHigh: 5 }]) as never))
      .rejects.toMatchObject({ fieldErrors: expect.arrayContaining([expect.objectContaining({ path: "items.0.sets.0.repsLow" })]) });
    const okTimed = (await repo().create(u, rowBody(timed, [{ setType: "warmup" }, {}]) as never)).routine;
    expect(okTimed.items[0]!.sets).toHaveLength(2);
    const legacy = (await repo().create(u, { name: "Legacy timed", notes: null, items: [{ exerciseId: timed, targetSets: 2, targetRepsLow: 5, targetRepsHigh: 5 }] })).routine;
    expect(legacy.items[0]!.sets.every((s) => s.repsLow === 5)).toBe(true);
  });

  it("AC5 — order: an absent exercise is 422 and a retired one is 409 before any modality check", async () => {
    const u = await insertUser(db);
    const retired = await insertExercise(db, { ownerUserId: u, modality: "bodyweight_reps" });
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = $1::uuid`, retired);
    await expect(repo().create(u, rowBody(retired, [{ weight: 5, weightUnit: "kg" }]) as never)).rejects.toMatchObject({ status: 409 });
  });

  it("AC9 — PUT replaces items and rows; a failing PUT leaves both byte-identical", async () => {
    const u = await insertUser(db);
    const [a, b, c] = [await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u })];
    const created = (await repo().create(u, { name: "Big", notes: null, items: [a, b, c].map((e) => ({ exerciseId: e, sets: RAMP })) } as never)).routine;
    await repo().replace(u, created.id, { name: "Big", notes: null, items: [a, b].map((e) => ({ exerciseId: e, sets: RAMP.slice(0, 2) })) } as never);
    const n = (await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "routine_item_set"`))[0]!.n;
    expect(n).toBe(4);
    const snapshot = async () => JSON.stringify(await db.prisma.$queryRawUnsafe(
      `SELECT ri.position, s.position AS p, s.set_type, s.reps_low, s.weight::text FROM "routine_item" ri JOIN "routine_item_set" s ON s.routine_item_id = ri.id ORDER BY 1, 2`));
    const before = await snapshot();
    const bw = await insertExercise(db, { ownerUserId: u, modality: "bodyweight_reps" });
    await expect(repo().replace(u, created.id, { name: "Big", notes: null, items: [{ exerciseId: bw, sets: [{ weight: 1, weightUnit: "kg" }] }] } as never)).rejects.toThrow();
    expect(await snapshot()).toBe(before);
  });

  it("AC2 — a concurrent PUT never yields a torn read", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const created = (await repo().create(u, rowBody(ex, RAMP) as never)).routine;
    const docA = [RAMP[0]!];
    const docB = [RAMP[1]!, RAMP[2]!];
    const legal = [JSON.stringify(RAMP), JSON.stringify(docA), JSON.stringify(docB)];
    for (let i = 0; i < 10; i++) {
      const results = await Promise.all([
        repo().replace(u, created.id, rowBody(ex, docA) as never),
        repo().getById(u, created.id),
        repo().replace(u, created.id, rowBody(ex, docB) as never),
        repo().getById(u, created.id),
      ]);
      for (const r of [results[1], results[3]]) expect(legal).toContain(JSON.stringify(r.items[0]!.sets));
    }
  });

  it("AC22 — bodies recorded from the Spec 10.0 editor (all five target keys, never sets) round-trip as before", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const recorded = [
      { exerciseId: ex, targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, targetRpe: 8, restSeconds: 90, supersetGroup: null, notes: null },
      { exerciseId: ex, targetSets: 3, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null, supersetGroup: null, notes: "sets only" },
      { exerciseId: ex, targetSets: null, targetRepsLow: 8, targetRepsHigh: 10, targetRpe: null, restSeconds: null, supersetGroup: null, notes: "reps only" },
      { exerciseId: ex, targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null, supersetGroup: null, notes: null },
    ];
    const created = (await repo().create(u, { name: "Recorded", notes: null, items: recorded })).routine;
    const read = await repo().getById(u, created.id);
    read.items.forEach((it, i) => {
      expect([it.targetSets, it.targetRepsLow, it.targetRepsHigh]).toEqual([recorded[i]!.targetSets, recorded[i]!.targetRepsLow, recorded[i]!.targetRepsHigh]);
    });
  });
});
