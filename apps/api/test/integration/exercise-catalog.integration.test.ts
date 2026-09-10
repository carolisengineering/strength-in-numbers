import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { MODALITY_VALUES } from "@sin/core";
import {
  shouldRunIntegration,
  startIntegrationDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 03.1 §4 / §10 — the `0002_create_exercise_catalog` schema, checked against
 * a real Postgres running the actual migration. AC1 (tables / indexes / FKs /
 * CHECK), AC2 (behavioural half — bad modality rejected, every valid one
 * accepted), AC3 (partial unique index on `catalog_key`).
 */
describe.skipIf(!shouldRunIntegration())(
  "Exercise catalog schema — integration (real Postgres)",
  () => {
    let db: IntegrationDb;

    beforeAll(async () => {
      // `describe.skipIf` still runs `beforeAll` when the guard is wrong
      // (CLAUDE.md), so gate the container start on the same condition.
      if (!shouldRunIntegration()) return;
      db = await startIntegrationDb();
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    beforeEach(async () => {
      if (!db) return;
      // `user` cascades into `exercise`; clears both between tests.
      await db.prisma.$executeRawUnsafe('TRUNCATE "exercise", "user" CASCADE');
    });

    /** Minimal raw insert — only the NOT NULL columns without a default. */
    function insertExercise(opts: {
      id?: string;
      name?: string;
      modality?: string;
      catalogKey?: string | null;
      ownerUserId?: string | null;
    }): Promise<number> {
      const {
        id = uuidv7(),
        name = "Test Exercise",
        modality = "weight_reps",
        catalogKey = null,
        ownerUserId = null,
      } = opts;
      // Positional params bind as text; uuid columns need an explicit cast.
      return db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id", "catalog_key", "owner_user_id", "name", "modality")
         VALUES ($1::uuid, $2, $3::uuid, $4, $5)`,
        id,
        catalogKey,
        ownerUserId,
        name,
        modality,
      );
    }

    async function insertUser(id: string): Promise<void> {
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
        id,
        `auth0|${id}`,
        "u@ex.com",
      );
    }

    describe("AC1 — migration creates the catalog schema", () => {
      it("creates exercise / muscle_group / equipment alongside 0001's user", async () => {
        const rows = await db.prisma.$queryRawUnsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN ('user', 'muscle_group', 'equipment', 'exercise')
           ORDER BY table_name`,
        );
        expect(rows.map((r) => r.table_name)).toEqual([
          "equipment",
          "exercise",
          "muscle_group",
          "user",
        ]);
      });

      it("gives exercise the columns and types from §4", async () => {
        const cols = await db.prisma.$queryRawUnsafe<
          { column_name: string; data_type: string; is_nullable: string }[]
        >(
          `SELECT column_name, data_type, is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'exercise'`,
        );
        const by = new Map(cols.map((c) => [c.column_name, c]));
        const col = (name: string) => {
          const c = by.get(name);
          if (!c) throw new Error(`exercise has no column "${name}"`);
          return c;
        };

        expect(col("id").data_type).toBe("uuid");
        expect(col("id").is_nullable).toBe("NO");
        expect(col("catalog_key").is_nullable).toBe("YES");
        expect(col("owner_user_id").data_type).toBe("uuid");
        expect(col("owner_user_id").is_nullable).toBe("YES");
        expect(col("name").is_nullable).toBe("NO");
        expect(col("modality").is_nullable).toBe("NO");
        expect(col("secondary_muscle_ids").data_type).toBe("ARRAY");
        expect(col("secondary_muscle_ids").is_nullable).toBe("NO");
        expect(col("is_active").data_type).toBe("boolean");
        expect(col("created_at").data_type).toBe("timestamp with time zone");
      });

      it("gives the reference tables a text PK and a smallint display_order", async () => {
        for (const table of ["muscle_group", "equipment"]) {
          const cols = await db.prisma.$queryRawUnsafe<
            { column_name: string; data_type: string }[]
          >(
            `SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1`,
            table,
          );
          const by = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]));
          expect(by.id).toBe("text");
          expect(by.display_order).toBe("smallint");
        }
      });

      it("creates the partial unique index plus the owner and updated_at indexes", async () => {
        const idx = await db.prisma.$queryRawUnsafe<
          { indexname: string; indexdef: string }[]
        >(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'exercise'`);
        const by = Object.fromEntries(idx.map((i) => [i.indexname, i.indexdef]));

        expect(by.exercise_catalog_key_key).toMatch(/UNIQUE INDEX/);
        expect(by.exercise_catalog_key_key).toMatch(
          /WHERE \(owner_user_id IS NULL\)/,
        );
        expect(by.exercise_owner_idx).toBeDefined();
        expect(by.exercise_owner_idx).not.toMatch(/UNIQUE/);
        expect(by.exercise_updated_at_idx).toBeDefined();
      });

      it("cascades exercise.owner_user_id on user delete; restricts the reference FKs", async () => {
        const fks = await db.prisma.$queryRawUnsafe<
          { constraint_name: string; delete_rule: string }[]
        >(
          `SELECT rc.constraint_name, rc.delete_rule
           FROM information_schema.referential_constraints rc
           JOIN information_schema.table_constraints tc
             ON tc.constraint_name = rc.constraint_name
            AND tc.constraint_schema = rc.constraint_schema
           WHERE tc.table_name = 'exercise'`,
        );
        const by = Object.fromEntries(
          fks.map((f) => [f.constraint_name, f.delete_rule]),
        );
        expect(by.exercise_owner_user_id_fkey).toBe("CASCADE");
        expect(by.exercise_primary_muscle_id_fkey).toBe("RESTRICT");
        expect(by.exercise_equipment_id_fkey).toBe("RESTRICT");
      });

      it("deletes a user's custom exercises when the user row is deleted (cascade)", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await insertExercise({ ownerUserId: userId, catalogKey: null });
        await db.prisma.$executeRawUnsafe(
          `DELETE FROM "user" WHERE "id" = $1::uuid`,
          userId,
        );
        const left = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "exercise" WHERE "owner_user_id" = $1::uuid`,
          userId,
        );
        expect(left).toHaveLength(1);
        expect(Number(left[0]?.n)).toBe(0);
      });
    });

    describe("AC2 — modality is constrained (behavioural)", () => {
      it("rejects a modality outside MODALITY_VALUES", async () => {
        await expect(insertExercise({ modality: "isometric_hold" })).rejects.toThrow();
      });

      it("accepts every MODALITY_VALUES member", async () => {
        for (const modality of MODALITY_VALUES) {
          await expect(insertExercise({ modality })).resolves.toBe(1);
        }
      });
    });

    describe("AC3 — catalog_key is unique among curated rows only", () => {
      it("rejects a second curated row with the same catalog_key", async () => {
        await insertExercise({ catalogKey: "back-squat", ownerUserId: null });
        await expect(
          insertExercise({ catalogKey: "back-squat", ownerUserId: null }),
        ).rejects.toThrow();
      });

      it("allows many curated rows with a null catalog_key", async () => {
        await expect(
          insertExercise({ catalogKey: null, ownerUserId: null }),
        ).resolves.toBe(1);
        await expect(
          insertExercise({ catalogKey: null, ownerUserId: null }),
        ).resolves.toBe(1);
      });

      it("exempts custom rows — two owned rows may share a catalog_key", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await expect(
          insertExercise({ catalogKey: "owned-key", ownerUserId: userId }),
        ).resolves.toBe(1);
        await expect(
          insertExercise({ catalogKey: "owned-key", ownerUserId: userId }),
        ).resolves.toBe(1);
      });
    });

    // Runs last: the "down" drops all three tables. Nothing after it needs them.
    describe("AC1 — down migration", () => {
      it("drops exercise, equipment, and muscle_group", async () => {
        await db.prisma.$executeRawUnsafe(
          'DROP TABLE "exercise", "equipment", "muscle_group"',
        );
        const rows = await db.prisma.$queryRawUnsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN ('muscle_group', 'equipment', 'exercise')`,
        );
        expect(rows).toEqual([]);
      });
    });
  },
);
