import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import {
  applyMigrationFile,
  shouldRunIntegration,
  startBareDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 03.3 §4 / §10 — AC1 (migration applies cleanly on top of 0003, is additive,
 * matches the Prisma model) and AC11 (`updated_at` + its index are untouched).
 * The schema is stopped at 0003, rows are inserted, and only then is 0004 applied.
 */
describe.skipIf(!shouldRunIntegration())(
  "AC1/AC11 — 0004_exercise_change_xid (real Postgres)",
  () => {
    let db: IntegrationDb;
    const preIds = [uuidv7(), uuidv7()];
    let preUpdatedAt: Date[] = [];

    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      db = await startBareDb();
      for (const m of [
        "0001_create_user",
        "0002_create_exercise_catalog",
        "0003_exercise_fork_provenance",
      ]) {
        applyMigrationFile(db.url, m);
      }
      // rows that exist BEFORE 0004
      for (const id of preIds) {
        await db.prisma.$executeRawUnsafe(
          `INSERT INTO "exercise" ("id","name","modality") VALUES ($1::uuid,'pre-existing','weight_reps')`,
          id,
        );
      }
      preUpdatedAt = (
        await db.prisma.$queryRawUnsafe<{ updated_at: Date }[]>(
          `SELECT updated_at FROM "exercise" ORDER BY id`,
        )
      ).map((r) => r.updated_at);
      applyMigrationFile(db.url, "0004_exercise_change_xid");
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    it("stamps every pre-existing row (non-null change_xid)", async () => {
      const rows = await db.prisma.$queryRawUnsafe<{ x: string | null }[]>(
        `SELECT change_xid::text AS x FROM "exercise"`,
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.x !== null)).toBe(true);
    });

    it("creates the NOT NULL column with the pg_current_xact_id() default", async () => {
      const [c] = await db.prisma.$queryRawUnsafe<
        { udt_name: string; is_nullable: string; column_default: string }[]
      >(
        `SELECT udt_name, is_nullable, column_default FROM information_schema.columns
         WHERE table_name='exercise' AND column_name='change_xid'`,
      );
      expect(c).toMatchObject({ udt_name: "xid8", is_nullable: "NO" });
      expect(c!.column_default).toContain("pg_current_xact_id()");
    });

    it("creates the function, the BEFORE INSERT OR UPDATE row trigger, and both indexes", async () => {
      const fn = await db.prisma.$queryRawUnsafe<{ proname: string }[]>(
        `SELECT proname FROM pg_proc WHERE proname='exercise_stamp_change_xid'`,
      );
      expect(fn).toHaveLength(1);
      const trg = await db.prisma.$queryRawUnsafe<{ def: string }[]>(
        `SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger
         WHERE tgrelid='exercise'::regclass AND tgname='exercise_change_xid'`,
      );
      expect(trg[0]!.def).toContain("BEFORE INSERT OR UPDATE");
      expect(trg[0]!.def).toContain("FOR EACH ROW");
      const idx = (
        await db.prisma.$queryRawUnsafe<{ indexname: string }[]>(
          `SELECT indexname FROM pg_indexes WHERE tablename='exercise'`,
        )
      ).map((r) => r.indexname);
      expect(idx).toContain("exercise_change_xid_idx");
      expect(idx).toContain("exercise_updated_at_idx"); // AC11: kept
    });

    it("AC11: 0004 leaves every pre-existing updated_at unchanged", async () => {
      const after = (
        await db.prisma.$queryRawUnsafe<{ updated_at: Date }[]>(
          `SELECT updated_at FROM "exercise" ORDER BY id`,
        )
      ).map((r) => r.updated_at);
      expect(after).toEqual(preUpdatedAt);
    });

    it("old-image writes (column list omits change_xid) are stamped by the trigger", async () => {
      const id = uuidv7();
      const horizon = (
        await db.prisma.$queryRawUnsafe<{ h: string }[]>(
          `SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS h`,
        )
      )[0]!.h;
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id","name","modality") VALUES ($1::uuid,'old-insert','weight_reps')`,
        id,
      );
      const [ins] = await db.prisma.$queryRawUnsafe<{ x: string }[]>(
        `SELECT change_xid::text AS x FROM "exercise" WHERE id=$1::uuid`,
        id,
      );
      expect(BigInt(ins!.x)).toBeGreaterThanOrEqual(BigInt(horizon));
      await db.prisma.$executeRawUnsafe(
        `UPDATE "exercise" SET name='old-update' WHERE id=$1::uuid`,
        id,
      );
      const [upd] = await db.prisma.$queryRawUnsafe<{ x: string }[]>(
        `SELECT change_xid::text AS x FROM "exercise" WHERE id=$1::uuid`,
        id,
      );
      expect(BigInt(upd!.x)).toBeGreaterThan(BigInt(ins!.x)); // re-stamped by the UPDATE
    });

    // D30's "no drift" assertion (a DB stopped at 0004 vs. the full
    // schema.prisma) was retired by Spec 05.0's 0005_create_workout_session:
    // this suite's `db` only ever migrates through 0004, so once
    // schema.prisma grew Workout/WorkoutExercise it always diffs, regardless
    // of 0004's own correctness. The equivalent no-drift check now lives on
    // the newest migration, where it belongs: see D49 in
    // workout-migration.integration.test.ts.
  },
);
