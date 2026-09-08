import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { NotFoundError } from "../../src/errors/app-error.js";
import type { ExerciseRepository } from "../../src/repositories/exercise.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import {
  shouldRunIntegration,
  startIntegrationDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 03.1 §6.1 / §10 AC5 (repository half) — the caller-visibility filter and
 * `COLLATE "C"` ordering against a real Postgres. The route + ETag/304 layer is
 * a later piece; here we prove the repo never leaks another user's row and
 * orders locale-independently.
 */
describe.skipIf(!shouldRunIntegration())(
  "Exercise repository — integration (real Postgres)",
  () => {
    let db: IntegrationDb;
    let repo: ExerciseRepository;

    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      db = await startIntegrationDb();
      repo = createExerciseRepository(db.prisma);
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    beforeEach(async () => {
      if (!db) return;
      await db.prisma.$executeRawUnsafe(
        'TRUNCATE "exercise", "muscle_group", "equipment", "user" CASCADE',
      );
    });

    async function insertUser(id: string): Promise<void> {
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
        id,
        `auth0|${id}`,
        "u@ex.com",
      );
    }

    function insertExercise(opts: {
      id?: string;
      name: string;
      modality?: string;
      ownerUserId?: string | null;
      isActive?: boolean;
    }): Promise<number> {
      const {
        id = uuidv7(),
        name,
        modality = "weight_reps",
        ownerUserId = null,
        isActive = true,
      } = opts;
      return db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id", "catalog_key", "owner_user_id", "name", "modality", "is_active")
         VALUES ($1::uuid, NULL, $2::uuid, $3, $4, $5)`,
        id,
        ownerUserId,
        name,
        modality,
        isActive,
      );
    }

    function insertMuscleGroup(
      id: string,
      name: string,
      order: number,
    ): Promise<number> {
      return db.prisma.$executeRawUnsafe(
        `INSERT INTO "muscle_group" ("id", "name", "display_order") VALUES ($1, $2, $3)`,
        id,
        name,
        order,
      );
    }

    function insertEquipment(
      id: string,
      name: string,
      order: number,
    ): Promise<number> {
      return db.prisma.$executeRawUnsafe(
        `INSERT INTO "equipment" ("id", "name", "display_order") VALUES ($1, $2, $3)`,
        id,
        name,
        order,
      );
    }

    describe("findVisibleCatalog", () => {
      it("returns active curated rows only, ordered by name COLLATE \"C\" then id", async () => {
        await insertExercise({ name: "banana" });
        await insertExercise({ name: "Apple" });
        await insertExercise({ name: "cherry", isActive: false });

        const { rows } = await repo.findVisibleCatalog(uuidv7());

        // COLLATE "C" is byte order: 'A' (0x41) sorts before 'b' (0x62).
        expect(rows.map((r) => r.name)).toEqual(["Apple", "banana"]);
        expect(rows.every((r) => r.isActive)).toBe(true);
      });

      it("includes the acting user's own custom rows but no other user's", async () => {
        const userA = uuidv7();
        const userB = uuidv7();
        await insertUser(userA);
        await insertUser(userB);

        await insertExercise({ name: "Global Squat" });
        await insertExercise({ name: "A custom row", ownerUserId: userA });
        await insertExercise({ name: "B custom row", ownerUserId: userB });

        const { rows } = await repo.findVisibleCatalog(userA);

        expect(rows.map((r) => r.name)).toEqual([
          "A custom row",
          "Global Squat",
        ]);
        expect(rows.some((r) => r.ownerUserId === userB)).toBe(false);
      });

      it("breaks a name tie by id", async () => {
        const first = "00000000-0000-7000-8000-000000000001";
        const second = "00000000-0000-7000-8000-000000000002";
        await insertExercise({ id: second, name: "Row" });
        await insertExercise({ id: first, name: "Row" });

        const { rows } = await repo.findVisibleCatalog(uuidv7());
        expect(rows.map((r) => r.id)).toEqual([first, second]);
      });

      it("maps every column, array intact", async () => {
        await insertExercise({ name: "Bench Press" });
        const { rows: [row] } = await repo.findVisibleCatalog(uuidv7());
        expect(row).toMatchObject({
          name: "Bench Press",
          modality: "weight_reps",
          catalogKey: null,
          ownerUserId: null,
          secondaryMuscleIds: [],
          isActive: true,
        });
        expect(row?.createdAt).toBeInstanceOf(Date);
      });
    });

    describe("findVisibleById", () => {
      it("returns a curated row", async () => {
        const id = uuidv7();
        await insertExercise({ id, name: "Deadlift" });
        const row = await repo.findVisibleById(uuidv7(), id);
        expect(row.name).toBe("Deadlift");
      });

      it("returns the acting user's own custom row", async () => {
        const userA = uuidv7();
        await insertUser(userA);
        const id = uuidv7();
        await insertExercise({ id, name: "My Curl", ownerUserId: userA });
        const row = await repo.findVisibleById(userA, id);
        expect(row.ownerUserId).toBe(userA);
      });

      it("throws NotFoundError for another user's custom row", async () => {
        const userA = uuidv7();
        const userB = uuidv7();
        await insertUser(userA);
        await insertUser(userB);
        const bRow = uuidv7();
        await insertExercise({ id: bRow, name: "B only", ownerUserId: userB });

        await expect(repo.findVisibleById(userA, bRow)).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });

      it("throws NotFoundError for an id that does not exist", async () => {
        await expect(
          repo.findVisibleById(uuidv7(), uuidv7()),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      it("finds an inactive row (no is_active gate on the lookup)", async () => {
        const id = uuidv7();
        await insertExercise({ id, name: "Retired Move", isActive: false });
        const row = await repo.findVisibleById(uuidv7(), id);
        expect(row.isActive).toBe(false);
      });
    });

    describe("reference tables", () => {
      it("listMuscleGroups orders by display_order then id COLLATE \"C\"", async () => {
        await insertMuscleGroup("lats", "Lats", 2);
        await insertMuscleGroup("chest", "Chest", 1);
        await insertMuscleGroup("abs", "Abs", 1);

        const rows = await repo.listMuscleGroups();
        expect(rows).toEqual([
          { id: "abs", name: "Abs", displayOrder: 1 },
          { id: "chest", name: "Chest", displayOrder: 1 },
          { id: "lats", name: "Lats", displayOrder: 2 },
        ]);
      });

      it("listEquipment orders the same way", async () => {
        await insertEquipment("dumbbell", "Dumbbell", 1);
        await insertEquipment("barbell", "Barbell", 1);
        await insertEquipment("machine", "Machine", 3);

        const rows = await repo.listEquipment();
        expect(rows.map((r) => r.id)).toEqual(["barbell", "dumbbell", "machine"]);
      });

      it("returns an empty array when a reference table is empty", async () => {
        expect(await repo.listEquipment()).toEqual([]);
      });
    });
  },
);
