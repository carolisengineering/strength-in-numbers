import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import {
  CustomExerciseLimitError,
  ExerciseAlreadyOwnedError,
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  NotFoundError,
  ValidationError,
} from "../../src/errors/app-error.js";
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
  "AC5 — exercise repository visibility + ordering (integration, real Postgres)",
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
      catalogKey?: string | null;
    }): Promise<number> {
      const {
        id = uuidv7(),
        name,
        modality = "weight_reps",
        ownerUserId = null,
        isActive = true,
        catalogKey = null,
      } = opts;
      return db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id", "catalog_key", "owner_user_id", "name", "modality", "is_active")
         VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6)`,
        id,
        catalogKey,
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

      it("maps forked_from_exercise_id (null for every existing row)", async () => {
        await insertExercise({ name: "Plain Row" });
        const { rows: [row] } = await repo.findVisibleCatalog(uuidv7());
        expect(row?.forkedFromExerciseId).toBeNull();
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

    describe("Spec 03.2 AC2/AC3 — createExercise", () => {
      const fields = {
        name: "Cable Fly",
        modality: "weight_reps",
        primaryMuscleId: null as string | null,
        secondaryMuscleIds: [] as string[],
        equipmentId: null as string | null,
      };

      it("inserts an owned row with catalogKey null and forkedFromExerciseId null", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const created = await repo.createExercise(userId, fields);
        expect(created).toMatchObject({
          catalogKey: null,
          ownerUserId: userId,
          forkedFromExerciseId: null,
          isActive: true,
          name: "Cable Fly",
        });
      });

      it("rejects unknown primaryMuscleId, secondaryMuscleIds, and equipmentId together in one error", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        try {
          await repo.createExercise(userId, {
            ...fields,
            primaryMuscleId: "no-such-muscle",
            secondaryMuscleIds: ["also-missing"],
            equipmentId: "no-such-equipment",
          });
          expect.unreachable("expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const paths = (err as ValidationError).fieldErrors!.map((f) => f.path);
          expect(paths).toEqual(
            expect.arrayContaining(["primaryMuscleId", "secondaryMuscleIds", "equipmentId"]),
          );
        }
      });

      it("accepts real muscle/equipment reference ids", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await insertMuscleGroup("chest", "Chest", 1);
        await insertEquipment("barbell", "Barbell", 1);
        const created = await repo.createExercise(userId, {
          ...fields,
          primaryMuscleId: "chest",
          equipmentId: "barbell",
        });
        expect(created.primaryMuscleId).toBe("chest");
      });

      it("admits the 500th active row, rejects the 501st with CustomExerciseLimitError", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await Promise.all(
          Array.from({ length: 499 }, () =>
            insertExercise({ name: `Seed ${uuidv7()}`, ownerUserId: userId, isActive: true }),
          ),
        );

        const ok = await repo.createExercise(userId, { ...fields, name: "Row 500" });
        expect(ok.ownerUserId).toBe(userId);

        await expect(
          repo.createExercise(userId, { ...fields, name: "Row 501" }),
        ).rejects.toBeInstanceOf(CustomExerciseLimitError);
      });

      it("does not count another user's or the caller's own retired rows toward the cap", async () => {
        const userA = uuidv7();
        const userB = uuidv7();
        await insertUser(userA);
        await insertUser(userB);
        await insertExercise({ name: "B's row", ownerUserId: userB, isActive: true });
        await insertExercise({ name: "A's retired row", ownerUserId: userA, isActive: false });

        const created = await repo.createExercise(userA, fields);
        expect(created.ownerUserId).toBe(userA);
      });
    });

    describe("Spec 03.2 AC4/AC5 — updateExercise", () => {
      it("updates an owned row in place: same id, updatedAt bumped", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Old Name", ownerUserId: userId });
        const before = await repo.findVisibleById(userId, id);

        const updated = await repo.updateExercise(userId, id, { name: "New Name" });
        expect(updated.id).toBe(id);
        expect(updated.name).toBe("New Name");
        expect(updated.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      });

      it("422s naming the field when a partial body, merged with the base row, restates primaryMuscleId", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertMuscleGroup("quads", "Quads", 1);
        await db.prisma.$executeRawUnsafe(
          `UPDATE "exercise" SET primary_muscle_id = NULL WHERE id = $1::uuid`,
          id,
        );
        await insertExercise({ id, name: "Squat", ownerUserId: userId });
        await db.prisma.$executeRawUnsafe(
          `UPDATE "exercise" SET primary_muscle_id = 'quads' WHERE id = $1::uuid`,
          id,
        );

        await expect(
          repo.updateExercise(userId, id, { secondaryMuscleIds: ["quads"] }),
        ).rejects.toMatchObject({ fieldErrors: [{ path: "secondaryMuscleIds" }] });
      });

      it("409 exercise-immutable-use-fork on a global row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Global Row" });

        await expect(
          repo.updateExercise(userId, id, { name: "Hijacked" }),
        ).rejects.toBeInstanceOf(ExerciseImmutableUseForkError);
      });

      it("409 exercise-retired on the caller's own already-soft-deleted row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Gone", ownerUserId: userId, isActive: false });

        await expect(
          repo.updateExercise(userId, id, { name: "Revived?" }),
        ).rejects.toBeInstanceOf(ExerciseRetiredError);
      });

      it("404 for an absent id and for another user's custom row, indistinguishable", async () => {
        const userA = uuidv7();
        const userB = uuidv7();
        await insertUser(userA);
        await insertUser(userB);
        const bRow = uuidv7();
        await insertExercise({ id: bRow, name: "B only", ownerUserId: userB });

        await expect(
          repo.updateExercise(userA, bRow, { name: "x" }),
        ).rejects.toBeInstanceOf(NotFoundError);
        await expect(
          repo.updateExercise(userA, uuidv7(), { name: "x" }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      it("a PATCH racing a concurrent DELETE on the same owned row never silently applies to a retired row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Racer", ownerUserId: userId, isActive: true });

        // `ExerciseRepository.deleteExercise` does not exist yet (it lands in a
        // later task in this same plan) — the concurrent DELETE side of this race
        // is driven directly against Postgres with the same
        // owner_user_id+is_active-gated soft-delete shape `deleteExercise` will
        // use, so this still exercises a genuine concurrent race against real
        // Postgres on `updateExercise`'s own WHERE-clause guard.
        const deleteRacer = db.prisma.$executeRawUnsafe(
          `UPDATE "exercise" SET is_active = false, updated_at = now()
           WHERE id = $1::uuid AND owner_user_id = $2::uuid AND is_active = true`,
          id,
          userId,
        );

        const [patchResult, deleteResult] = await Promise.allSettled([
          repo.updateExercise(userId, id, { name: "Renamed" }),
          deleteRacer,
        ]);

        expect(deleteResult.status).toBe("fulfilled"); // soft-delete is idempotent — always succeeds

        const final = await db.prisma.$queryRawUnsafe<{ name: string; is_active: boolean }[]>(
          `SELECT name, is_active FROM "exercise" WHERE id = $1::uuid`,
          id,
        );
        expect(final[0]?.is_active).toBe(false);
        if (patchResult.status === "fulfilled") {
          expect(final[0]?.name).toBe("Renamed");
        } else {
          expect((patchResult as PromiseRejectedResult).reason).toBeInstanceOf(ExerciseRetiredError);
          expect(final[0]?.name).toBe("Racer");
        }
      });
    });

    describe("Spec 03.2 AC6/AC7/AC10 — forkExercise", () => {
      it("copies unedited origin fields, sets ownerUserId/forkedFromExerciseId, leaves the origin byte-for-byte unchanged", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await insertMuscleGroup("quads", "Quads", 1);
        await insertEquipment("barbell", "Barbell", 1);
        const originId = uuidv7();
        await insertExercise({ id: originId, name: "Back Squat", catalogKey: "back-squat" });
        await db.prisma.$executeRawUnsafe(
          `UPDATE "exercise" SET primary_muscle_id = 'quads', equipment_id = 'barbell' WHERE id = $1::uuid`,
          originId,
        );
        const originBefore = await repo.findVisibleById(userId, originId);

        const forked = await repo.forkExercise(userId, originId, {});
        expect(forked).toMatchObject({
          catalogKey: null,
          ownerUserId: userId,
          forkedFromExerciseId: originId,
          name: "Back Squat",
          primaryMuscleId: "quads",
          equipmentId: "barbell",
        });

        const originAfter = await repo.findVisibleById(userId, originId);
        expect(originAfter).toEqual(originBefore);
      });

      it("applies overlay fields on top of the origin's copied fields", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const originId = uuidv7();
        await insertExercise({ id: originId, name: "Deadlift", catalogKey: "deadlift" });

        const forked = await repo.forkExercise(userId, originId, { name: "My Deadlift" });
        expect(forked.name).toBe("My Deadlift");
      });

      it("422s when the overlay, merged with the origin's unedited fields, restates primaryMuscleId", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const originId = uuidv7();
        await insertExercise({ id: originId, name: "Row", catalogKey: "row" });
        await insertMuscleGroup("lats", "Lats", 1);
        await db.prisma.$executeRawUnsafe(
          `UPDATE "exercise" SET primary_muscle_id = 'lats' WHERE id = $1::uuid`,
          originId,
        );

        await expect(
          repo.forkExercise(userId, originId, { secondaryMuscleIds: ["lats"] }),
        ).rejects.toMatchObject({ fieldErrors: [{ path: "secondaryMuscleIds" }] });
      });

      it("409 exercise-already-owned when forking the caller's own row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Mine", ownerUserId: userId });

        await expect(repo.forkExercise(userId, id, {})).rejects.toBeInstanceOf(
          ExerciseAlreadyOwnedError,
        );
      });

      it("409 exercise-retired when forking a retired global row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Dead", isActive: false });

        await expect(repo.forkExercise(userId, id, {})).rejects.toBeInstanceOf(
          ExerciseRetiredError,
        );
      });

      it("404 for an absent id", async () => {
        await expect(repo.forkExercise(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });

      it("both origin and fork remain visible together, forkedFromExerciseId correct", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const originId = uuidv7();
        await insertExercise({ id: originId, name: "Bench", catalogKey: "bench" });

        const forked = await repo.forkExercise(userId, originId, {});
        const { rows } = await repo.findVisibleCatalog(userId);
        const originRow = rows.find((r) => r.id === originId);
        const forkRow = rows.find((r) => r.id === forked.id);
        expect(originRow).toBeDefined();
        expect(forkRow).toMatchObject({ forkedFromExerciseId: originId });
      });

      it("shares the create cap: a mixed create+fork burst at the 499/500 boundary never exceeds it", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await Promise.all(
          Array.from({ length: 499 }, () =>
            insertExercise({ name: `Seed ${uuidv7()}`, ownerUserId: userId, isActive: true }),
          ),
        );
        const globalId = uuidv7();
        await insertExercise({ id: globalId, name: "Global Row" });

        const results = await Promise.allSettled([
          repo.createExercise(userId, {
            name: "Race Create",
            modality: "weight_reps",
            primaryMuscleId: null,
            secondaryMuscleIds: [],
            equipmentId: null,
          }),
          repo.forkExercise(userId, globalId, {}),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
          CustomExerciseLimitError,
        );

        const finalCount = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "exercise" WHERE owner_user_id = $1::uuid AND is_active = true`,
          userId,
        );
        expect(Number(finalCount[0]?.n)).toBe(500);
      });
    });
  },
);
