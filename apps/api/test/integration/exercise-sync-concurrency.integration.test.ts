import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
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
 * Spec 03.3 §10 AC5 / AC6 — the regression tests for #23 / BL-1. Each interleaving
 * used to let a delta's cursor advance past a not-yet-committed row (via a
 * *different*, already-visible row) so the row was skipped forever; with the sync
 * token, the NEXT delta must contain it.
 *
 * `lockClient` is a second Prisma client (its own connection pool) that plays the
 * blocking transaction. The permanent tests target the new API and so cannot also
 * "fail against the old build"; the red step for AC5 was recorded separately
 * against the timestamp cursor (see the PR description).
 */

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe.skipIf(!shouldRunIntegration())(
  "AC5/AC6 — sync token never skips a late commit (integration, real Postgres)",
  () => {
    let db: IntegrationDb;
    let lockClient: PrismaClient;
    let repo: ExerciseRepository;

    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      db = await startIntegrationDb();
      lockClient = new PrismaClient({ datasourceUrl: db.url });
      repo = createExerciseRepository(db.prisma);
    }, 180_000);

    afterAll(async () => {
      await lockClient?.$disconnect();
      await db?.stop();
    });

    beforeEach(async () => {
      if (!db) return;
      await db.prisma.$executeRawUnsafe('TRUNCATE "exercise", "user" CASCADE');
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
      id: string;
      name: string;
      ownerUserId?: string | null;
      catalogKey?: string | null;
    }): Promise<number> {
      const { id, name, ownerUserId = null, catalogKey = null } = opts;
      return db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id","catalog_key","owner_user_id","name","modality")
         VALUES ($1::uuid, $2, $3::uuid, $4, 'weight_reps')`,
        id,
        catalogKey,
        ownerUserId,
        name,
      );
    }

    /** Polls until some session is waiting on an advisory lock. */
    async function waitForBlockedAdvisoryLock(): Promise<void> {
      for (let i = 0; i < 200; i++) {
        const rows = await db.prisma.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted`;
        if (rows[0]!.n >= 1) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error("the create never blocked on the advisory lock");
    }

    it("AC5 (#23): a create blocked behind the per-user advisory lock is delivered by the NEXT delta", async () => {
      const u = uuidv7();
      const bId = uuidv7();
      await insertUser(u);
      await insertExercise({ id: bId, name: "B", ownerUserId: u });
      const t0 = parseSyncToken((await repo.findCatalog(u)).syncToken);

      // Connection L holds the same advisory lock insertWithCap takes.
      const held = deferred();
      const release = deferred();
      const holder = lockClient.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${u}))`;
          held.resolve();
          await release.promise;
        },
        { timeout: 60_000 },
      );
      await held.promise;

      // Not awaited: it blocks inside its transaction, before its INSERT — so it
      // holds no xid yet.
      const createP = repo.createExercise(u, {
        name: "A-created",
        modality: "weight_reps",
        primaryMuscleId: null,
        secondaryMuscleIds: [],
        equipmentId: null,
      });
      await waitForBlockedAdvisoryLock();

      // A different owned row is patched with no lock, and commits.
      await repo.updateExercise(u, bId, { name: "B-patched" });
      const d1 = await repo.findCatalog(u, t0);
      expect(d1.rows.map((r) => r.name)).toContain("B-patched");

      release.resolve();
      await holder;
      const created = await createP;

      // The bug: the timestamp cursor had advanced past `created` via B, so it was
      // skipped forever. The token's xid horizon cannot pass a not-yet-assigned xid.
      const d2 = await repo.findCatalog(u, parseSyncToken(d1.syncToken));
      expect(d2.rows.map((r) => r.id)).toContain(created.id);
    }, 60_000);

    it("AC6: a seed-style transaction held open past its statement is not skipped after a concurrent PATCH", async () => {
      const u = uuidv7();
      const bId = uuidv7();
      const globalId = uuidv7();
      await insertUser(u);
      await insertExercise({ id: bId, name: "B", ownerUserId: u });
      await insertExercise({ id: globalId, name: "Global", catalogKey: "global-one" });
      const t0 = parseSyncToken((await repo.findCatalog(u)).syncToken);

      // The seed's shape: write a global row, then stay open past the statement.
      const wrote = deferred();
      const release = deferred();
      const seedTx = lockClient.$transaction(
        async (tx) => {
          await tx.$executeRaw`
            UPDATE "exercise" SET name = 'Global v2', updated_at = now()
            WHERE id = ${globalId}::uuid`;
          wrote.resolve();
          await release.promise;
        },
        { timeout: 60_000 },
      );
      await wrote.promise;

      await repo.updateExercise(u, bId, { name: "B-patched" }); // concurrent PATCH commits
      const d1 = await repo.findCatalog(u, t0);
      expect(d1.rows.map((r) => r.name)).toContain("B-patched");
      expect(d1.rows.map((r) => r.name)).not.toContain("Global v2"); // not committed yet

      release.resolve();
      await seedTx;

      // d1's token is held back by the open seed transaction's xid, so the next
      // delta still covers the seed's revision.
      const d2 = await repo.findCatalog(u, parseSyncToken(d1.syncToken));
      expect(d2.rows.find((r) => r.id === globalId)?.name).toBe("Global v2");
    }, 60_000);
  },
);
