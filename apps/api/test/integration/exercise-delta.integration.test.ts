import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import type { ExerciseRepository } from "../../src/repositories/exercise.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import {
  shouldRunIntegration,
  startIntegrationDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 03.1 §6.1 / §10 AC6 (repository half) — the `updated_since` delta query
 * and the `serverTime` derivation: `LEAST(transaction_timestamp(),
 * GREATEST(:since, MAX(updated_at)))` truncated **down** to whole milliseconds,
 * the `::timestamptz` in-query bind, tombstones in the delta, and the
 * future-cursor clamp.
 */
describe.skipIf(!shouldRunIntegration())(
  "AC6 — exercise delta + serverTime (integration, real Postgres)",
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
        'TRUNCATE "exercise", "user" CASCADE',
      );
    });

    /** Insert a row, optionally stamping an exact `updated_at` (µs precision). */
    function insertExercise(opts: {
      id?: string;
      name: string;
      ownerUserId?: string | null;
      isActive?: boolean;
      updatedAt?: string;
    }): Promise<number> {
      const {
        id = uuidv7(),
        name,
        ownerUserId = null,
        isActive = true,
        updatedAt,
      } = opts;
      if (updatedAt !== undefined) {
        return db.prisma.$executeRawUnsafe(
          `INSERT INTO "exercise"
             ("id", "catalog_key", "owner_user_id", "name", "modality", "is_active", "updated_at")
           VALUES ($1::uuid, NULL, $2::uuid, $3, 'weight_reps', $4, $5::timestamptz)`,
          id,
          ownerUserId,
          name,
          isActive,
          updatedAt,
        );
      }
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

    describe("findCatalogDelta — row selection", () => {
      it("returns only rows changed after `since`, ordered by name COLLATE \"C\"", async () => {
        await insertExercise({ name: "old", updatedAt: "2020-01-01T00:00:00Z" });
        await insertExercise({ name: "Newer", updatedAt: "2021-06-01T00:00:00Z" });
        await insertExercise({ name: "newest", updatedAt: "2021-06-02T00:00:00Z" });

        const { rows } = await repo.findCatalogDelta(
          uuidv7(),
          "2021-01-01T00:00:00.000Z",
        );
        expect(rows.map((r) => r.name)).toEqual(["Newer", "newest"]);
      });

      it("includes rows retired since `since` as tombstones (no is_active gate)", async () => {
        await insertExercise({
          name: "Retired",
          isActive: false,
          updatedAt: "2021-06-01T00:00:00Z",
        });

        const { rows } = await repo.findCatalogDelta(
          uuidv7(),
          "2021-01-01T00:00:00.000Z",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: "Retired", isActive: false });
      });

      it("applies the visibility filter — user A's delta never returns user B's changed row", async () => {
        const userA = uuidv7();
        const userB = uuidv7();
        await insertUser(userA);
        await insertUser(userB);
        await insertExercise({
          name: "B change",
          ownerUserId: userB,
          updatedAt: "2021-06-01T00:00:00Z",
        });
        await insertExercise({
          name: "global change",
          updatedAt: "2021-06-01T00:00:00Z",
        });

        const { rows } = await repo.findCatalogDelta(
          userA,
          "2021-01-01T00:00:00.000Z",
        );
        expect(rows.map((r) => r.name)).toEqual(["global change"]);
      });
    });

    describe("serverTime derivation", () => {
      it("non-empty delta → MAX(updated_at) of the returned rows, ms-truncated", async () => {
        await insertExercise({
          name: "a",
          updatedAt: "2021-06-01T00:00:00.250000Z",
        });
        await insertExercise({
          name: "b",
          updatedAt: "2021-06-02T09:30:00.123456Z",
        });

        const { serverTime } = await repo.findCatalogDelta(
          uuidv7(),
          "2021-01-01T00:00:00.000Z",
        );
        // truncated down to ms (drops .123456 → .123), clamp is a no-op (now ≫ 2021)
        expect(serverTime.toISOString()).toBe("2021-06-02T09:30:00.123Z");
      });

      it("empty delta → the `since` cursor echoed back (clamped to now)", async () => {
        const { rows, serverTime } = await repo.findCatalogDelta(
          uuidv7(),
          "2025-06-01T00:00:00.000Z",
        );
        expect(rows).toEqual([]);
        expect(serverTime.toISOString()).toBe("2025-06-01T00:00:00.000Z");
      });

      it("a future `since` is clamped to server-now, never echoed forward", async () => {
        const { rows, serverTime } = await repo.findCatalogDelta(
          uuidv7(),
          "2099-01-01T00:00:00.000Z",
        );
        expect(rows).toEqual([]);
        expect(serverTime.getTime()).toBeLessThan(
          Date.parse("2099-01-01T00:00:00.000Z"),
        );
        expect(serverTime.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
      });

      it("full pull → LEAST(now, MAX(updated_at)) ms-truncated; empty set → now", async () => {
        const empty = await repo.findVisibleCatalog(uuidv7());
        expect(empty.rows).toEqual([]);
        expect(empty.serverTime.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);

        await insertExercise({
          name: "only",
          updatedAt: "2022-03-04T05:06:07.891011Z",
        });
        const full = await repo.findVisibleCatalog(uuidv7());
        expect(full.serverTime.toISOString()).toBe("2022-03-04T05:06:07.891Z");
      });
    });

    describe("microsecond boundary (truncate-down never skips a revision)", () => {
      it("a row stamped with µs precision is still returned by the delta at the ms-truncated cursor", async () => {
        await insertExercise({
          name: "precise",
          updatedAt: "2020-01-01T00:00:00.123456Z",
        });

        // The cursor a client would hold: the full pull's ms-truncated serverTime.
        const { serverTime } = await repo.findVisibleCatalog(uuidv7());
        expect(serverTime.toISOString()).toBe("2020-01-01T00:00:00.123Z");

        // Round-trip it through JSON, feed back as `updated_since`.
        const cursor = JSON.parse(JSON.stringify(serverTime.toISOString())) as string;
        const { rows } = await repo.findCatalogDelta(uuidv7(), cursor);
        expect(rows.map((r) => r.name)).toEqual(["precise"]);

        // Sanity: the exact µs value excludes it (`>` is strict).
        const exact = await repo.findCatalogDelta(
          uuidv7(),
          "2020-01-01T00:00:00.123456Z",
        );
        expect(exact.rows).toEqual([]);
      });
    });
  },
);
