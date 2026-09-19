import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import type { ExerciseRepository } from "../../src/repositories/exercise.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { parseSyncToken } from "../../src/repositories/sync-token.js";
import {
  shouldRunIntegration,
  startIntegrationDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 03.3 §6.3 / §10 AC4 (repository half) — the `since` delta by sync token:
 * row selection by `change_xid >= since`, tombstones in the delta, the
 * full-pull/delta split, and the caller-visibility filter (ported from Spec 03.1
 * AC5). The token semantics under concurrency live in the sibling
 * `exercise-snapshot-semantics` / `exercise-sync-concurrency` suites.
 *
 * Rows are inserted with plain autocommit statements, so each gets its own
 * increasing xid; a token taken between two inserts cleanly separates them.
 */
describe.skipIf(!shouldRunIntegration())(
  "AC4 — exercise catalog delta by sync token (integration, real Postgres)",
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
      await db.prisma.$executeRawUnsafe('TRUNCATE "exercise", "user" CASCADE');
    });

    function insertExercise(opts: {
      id?: string;
      name: string;
      ownerUserId?: string | null;
      isActive?: boolean;
    }): Promise<number> {
      const { id = uuidv7(), name, ownerUserId = null, isActive = true } = opts;
      return db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise"
           ("id", "catalog_key", "owner_user_id", "name", "modality", "is_active")
         VALUES ($1::uuid, NULL, $2::uuid, $3, 'weight_reps', $4)`,
        id,
        ownerUserId,
        name,
        isActive,
      );
    }

    function insertUser(id: string): Promise<number> {
      return db.prisma.$executeRawUnsafe(
        `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
        id,
        `auth0|${id}`,
        "u@ex.com",
      );
    }

    /** The bare xid a client would replay, taken from a fresh full pull. */
    const tokenNow = async (userId: string): Promise<string> =>
      parseSyncToken((await repo.findCatalog(userId)).syncToken);

    it('returns only rows changed at/after `since`, ordered by name COLLATE "C"', async () => {
      const u = uuidv7();
      await insertExercise({ name: "old" });
      const since = await tokenNow(u); // every finished transaction is < token
      await insertExercise({ name: "Newer" });
      await insertExercise({ name: "newest" });

      const { rows } = await repo.findCatalog(u, since);
      expect(rows.map((r) => r.name)).toEqual(["Newer", "newest"]);
    });

    it("includes rows retired since `since` as tombstones (no is_active gate)", async () => {
      const u = uuidv7();
      const since = await tokenNow(u);
      await insertExercise({ name: "Retired", isActive: false });

      const { rows } = await repo.findCatalog(u, since);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: "Retired", isActive: false });
    });

    it("full pull excludes tombstones; an empty visible set still returns a 1.<n> token", async () => {
      const empty = await repo.findCatalog(uuidv7());
      expect(empty.rows).toEqual([]);
      expect(empty.syncToken).toMatch(/^1\.\d+$/);

      await insertExercise({ name: "live" });
      await insertExercise({ name: "dead", isActive: false });
      const { rows } = await repo.findCatalog(uuidv7());
      expect(rows.map((r) => r.name)).toEqual(["live"]);
    });

    it("applies the visibility filter — user A's delta never returns user B's changed row", async () => {
      const userA = uuidv7();
      const userB = uuidv7();
      await insertUser(userA);
      await insertUser(userB);
      const since = await tokenNow(userA);
      await insertExercise({ name: "B change", ownerUserId: userB });
      await insertExercise({ name: "global change" });

      const { rows } = await repo.findCatalog(userA, since);
      expect(rows.map((r) => r.name)).toEqual(["global change"]);
    });
  },
);
