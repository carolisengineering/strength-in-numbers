import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import {
  shouldRunIntegration,
  startIntegrationDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 03.3 §10 AC8 (410 half) — a `since` ahead of the current snapshot's
 * `xmax` is `410 sync-token-expired`. The comparison needs a real snapshot, so
 * this drives `fastify.inject` against the real repository on real Postgres.
 */
describe.skipIf(!shouldRunIntegration())(
  "AC8 — future token → 410 (integration, real Postgres)",
  () => {
    let db: IntegrationDb;

    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      db = await startIntegrationDb();
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    const BEARER = { authorization: "Bearer test-token" };

    /** Reads consume no xid, so nothing else moves `xmax` between this and the request. */
    const xmax = async (): Promise<bigint> =>
      BigInt(
        (
          await db.prisma.$queryRaw<{ x: string }[]>`
            SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS x`
        )[0]!.x,
      );

    it.each(["GET", "HEAD"] as const)(
      "%s: since = xmax+1 → 410 no-store; since = xmax → 200",
      async (method) => {
        const { app } = await buildTestApp({
          exerciseRepository: createExerciseRepository(db.prisma),
        });
        const x = await xmax();

        const future = await app.inject({
          method,
          url: `/v1/exercises?since=1.${x + 1n}`,
          headers: BEARER,
        });
        expect(future.statusCode).toBe(410);
        expect(future.headers["cache-control"]).toBe("no-store");
        if (method === "GET") {
          expect(future.json().type).toContain("sync-token-expired");
        }

        // A legitimate token can equal xmax (nothing in flight, so xmin = xmax):
        // it must NOT be treated as "future".
        const edge = await app.inject({
          method,
          url: `/v1/exercises?since=1.${x}`,
          headers: BEARER,
        });
        expect(edge.statusCode).toBe(200);
      },
    );
  },
);
