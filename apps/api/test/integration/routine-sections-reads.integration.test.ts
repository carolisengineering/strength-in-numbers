import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RoutineWriteSchema } from "@sin/core";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import type { RoutineRecord } from "../../src/repositories/routine.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { settleCapture, startCapture } from "./one-off-helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

/** Spec 09.2 AC30. Measure once locally (`console.log(ms)`), set to max(1 000, 5 × measured). */
const LIST_BOUND_MS = 1_000;

describe.skipIf(!shouldRunIntegration())("Spec 09.2 — routine reads (real Postgres)", () => {
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
    await assertSectionsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const repo = () => createRoutineRepository(db.prisma);

  it("AC2 — racing PUTs of two different documents never produce a torn read", async () => {
    const u = await insertUser(db);
    const [a, b, c] = [await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u })];
    const docA = RoutineWriteSchema.parse({
      name: "R", sections: [{ key: "s", name: "Alpha" }], items: [{ exerciseId: a, sectionKey: "s" }, { exerciseId: b, sectionKey: "s" }],
    });
    const docB = RoutineWriteSchema.parse({
      name: "R", sections: [{ key: "t", name: "Beta", notes: "n" }, { key: "u", name: "Gamma" }],
      items: [{ exerciseId: c }, { exerciseId: a, sectionKey: "t" }, { exerciseId: b, sectionKey: "u" }],
    });
    const signature = (r: RoutineRecord) =>
      JSON.stringify({
        s: r.sections.map((s) => [s.position, s.name, s.notes]),
        i: r.items.map((it) => [it.position, it.exerciseId, r.sections.find((s) => s.id === it.sectionId)?.name ?? null]),
      });
    const created = (await repo().create(u, docA)).routine;
    const sigA = signature(created);
    const sigB = signature(await repo().replace(u, created.id, docB));
    await repo().replace(u, created.id, docA);
    const writers = Array.from({ length: 20 }, (_, k) => repo().replace(u, created.id, k % 2 ? docA : docB));
    const readers = Array.from({ length: 40 }, () => repo().getById(u, created.id));
    const results = await Promise.all([...writers, ...readers]);
    for (const r of results) expect([sigA, sigB]).toContain(signature(r));
  });

  it("AC30 — 50 routines × 30 items × 20 rows × 8 sections are read in ONE statement (plus the 09.3 sweep probe; amended by 09.3 AC30) within the bound", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    await db.prisma.$executeRawUnsafe(`INSERT INTO "routine" (id, user_id, name) SELECT gen_random_uuid(), $1::uuid, 'R' || g FROM generate_series(1, 50) g`, u);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine_section" (id, routine_id, position, name, notes)
       SELECT gen_random_uuid(), r.id, p, repeat('n', 40), repeat('x', 2000) FROM "routine" r, generate_series(0, 7) p WHERE r.user_id = $1::uuid`, u);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine_item" (id, routine_id, position, exercise_id, target_sets, target_reps_low, target_reps_high, section_id)
       SELECT gen_random_uuid(), r.id, p, $2::uuid, 20, 5, 5,
              (SELECT s.id FROM "routine_section" s WHERE s.routine_id = r.id AND s.position = LEAST(7, p / 4))
       FROM "routine" r, generate_series(0, 29) p WHERE r.user_id = $1::uuid`, u, ex);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine_item_set" (id, routine_item_id, position, set_type, reps_low, reps_high, weight, weight_unit)
       SELECT gen_random_uuid(), ri.id, s, 'working', 5, 5, 100, 'kg' FROM "routine_item" ri, generate_series(0, 19) s`);
    const seen = await startCapture(db);
    const t0 = Date.now();
    const list = (await repo().list(u)).routines;
    const ms = Date.now() - t0;
    await settleCapture(db, seen);
    expect(list).toHaveLength(50);
    expect(list.every((r) => r.sections.length === 8)).toBe(true);
    expect(list.reduce((n, r) => n + r.items.reduce((m, i) => m + i.sets.length, 0), 0)).toBe(30_000);
    expect(list[0]!.items.every((i) => i.sectionId !== null)).toBe(true);
    expect(seen).toHaveLength(2); // amended by 09.3 AC30: the sweep probe, then the one list statement
    expect(ms).toBeLessThan(LIST_BOUND_MS);
  });
});
