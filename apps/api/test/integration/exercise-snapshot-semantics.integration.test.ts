import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import type { ExerciseRepository } from "../../src/repositories/exercise.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import {
  shouldRunIntegration,
  startIntegrationDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 03.3 §10 AC3 / AC7 (integration layer) — pins the Postgres semantic the
 * whole design rests on: `pg_current_snapshot()` is evaluated against the
 * *statement's* snapshot, so a token and its rows describe the same instant, and
 * a transaction that commits mid-statement is in neither.
 *
 * Two connections: `db.prisma` runs one slow statement; `other` commits a write
 * while it sleeps. `pg_sleep` returns `void`, which Prisma cannot deserialize,
 * so the sleep is done via `(SELECT count(*) FROM pg_sleep(1))`.
 */
describe.skipIf(!shouldRunIntegration())(
  "AC3/AC7 — token and rows share one snapshot (integration, real Postgres)",
  () => {
    let db: IntegrationDb;
    let other: PrismaClient;
    let repo: ExerciseRepository;

    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      db = await startIntegrationDb();
      other = new PrismaClient({ datasourceUrl: db.url });
      repo = createExerciseRepository(db.prisma);
    }, 180_000);

    afterAll(async () => {
      await other?.$disconnect();
      await db?.stop();
    });

    beforeEach(async () => {
      if (!db) return;
      await db.prisma.$executeRawUnsafe('TRUNCATE "exercise", "user" CASCADE');
    });

    const xidOf = async (id: string): Promise<bigint> =>
      BigInt(
        (
          await db.prisma.$queryRawUnsafe<{ x: string }[]>(
            `SELECT change_xid::text AS x FROM "exercise" WHERE id = $1::uuid`,
            id,
          )
        )[0]!.x,
      );

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /**
     * A `PrismaPromise` is lazy — the statement is only sent once it is awaited or
     * `.then`-ed. The race below needs the slow statement *in flight* before the
     * other connection commits, so kick it off eagerly.
     */
    const startNow = <T>(p: PromiseLike<T>): Promise<T> =>
      Promise.resolve(p.then((r) => r));

    it("AC3: a commit landing mid-statement is in neither the token nor the rows, and the next delta returns it", async () => {
      const u = uuidv7();
      const reader = startNow(
        db.prisma.$queryRaw<{ token: string; slept: number; n: number }[]>`
          SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS token,
                 (SELECT count(*) FROM pg_sleep(1))::int AS slept,
                 (SELECT count(*) FROM "exercise" WHERE name = 'raced')::int AS n`,
      );
      await sleep(300); // let the reader's statement (and snapshot) start

      const racedId = uuidv7();
      await other.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id","name","modality") VALUES ($1::uuid,'raced','weight_reps')`,
        racedId,
      );

      const { token, n } = (await reader)[0]!;
      expect(n).toBe(0); // the reader's rows exclude the concurrent commit
      expect(BigInt(token)).toBeLessThanOrEqual(await xidOf(racedId)); // token not above it
      const next = await repo.findCatalog(u, token);
      expect(next.rows.map((r) => r.name)).toContain("raced");
    });

    it("AC7: an EMPTY delta uses the same snapshot as its (absent) rows", async () => {
      const u = uuidv7();
      // `since` = current xmax → no existing row has change_xid >= it → zero rows.
      const since = (
        await db.prisma.$queryRaw<{ x: string }[]>`
          SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS x`
      )[0]!.x;

      // The delta statement's shape, with a sleep so a commit can land mid-statement.
      const reader = startNow(
        db.prisma.$queryRaw<
          { token: string; slept: number; rows_seen: number }[]
        >`
          WITH snap AS (SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS token)
          SELECT snap.token,
                 (SELECT count(*) FROM pg_sleep(1))::int AS slept,
                 (SELECT count(*) FROM "exercise" e
                   WHERE e.change_xid >= ${since}::xid8)::int AS rows_seen
          FROM snap`,
      );
      await sleep(300);

      const racedId = uuidv7();
      await other.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id","name","modality") VALUES ($1::uuid,'raced-empty','weight_reps')`,
        racedId,
      );

      const { token, rows_seen } = (await reader)[0]!;
      expect(rows_seen).toBe(0); // the delta was empty…
      expect(BigInt(token)).toBeLessThanOrEqual(await xidOf(racedId)); // …and its token did not jump past the commit
      const next = await repo.findCatalog(u, token);
      expect(next.rows.map((r) => r.name)).toContain("raced-empty");
    });
  },
);
