import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "../helpers.js";
import { makeCrossUserApp } from "./app.js";
import { buildWorld, type World } from "./world.js";
import { OWNERSHIP_MAP, snapshot, userReachableTables } from "./snapshot.js";

/** Spec 21.0 §6.2 — the world the cross-user cases run in, and the snapshots that watch it. */
describe.skipIf(!shouldRunIntegration())("Spec 21.0 — cross-user world (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance;
  let as: (actor: "A" | "B" | "C") => Record<string, string>;
  let world: World;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    world = await buildWorld(db);
    ({ app, as } = await makeCrossUserApp(db, { hevyUsers: [world.a.userId] }));
  }, 300_000);
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  const ownedCounts = async (userId: string) => {
    const counts: Record<string, number> = {};
    for (const [table, sql] of Object.entries(OWNERSHIP_MAP)) {
      const rows = await db.prisma.$queryRawUnsafe<unknown[]>(sql, userId);
      counts[table] = rows.length;
    }
    return counts;
  };

  it("AC7 — A and B each own at least one row in every owned table", async () => {
    for (const user of [world.a.userId, world.b.userId]) {
      const counts = await ownedCounts(user);
      for (const [table, n] of Object.entries(counts)) expect(n, `${table} for ${user === world.a.userId ? "A" : "B"}`).toBeGreaterThan(0);
    }
  });

  it("AC7 — every B marker is in B's snapshot, and none in A's", async () => {
    const b = await snapshot(db, world.b.userId);
    const a = await snapshot(db, world.a.userId);
    expect(world.b.markers.length).toBeGreaterThan(10);
    for (const m of world.b.markers) {
      expect(b, m).toContain(m);
      expect(a, m).not.toContain(m);
    }
  });

  it("AC7 — B's ids cover every row B owns, and none of them is A's", async () => {
    const a = await snapshot(db, world.a.userId);
    expect(world.b.allIds).toContain(world.b.userId);
    expect(world.b.allIds).toContain(world.b.finishedSet);
    for (const id of world.b.allIds) expect(a, id).not.toContain(id);
  });

  it("AC7 — C has a routine and no live workout", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/workouts/active", headers: as("C") });
    expect(res.statusCode).toBe(404);
    const routine = await app.inject({ method: "GET", url: `/v1/routines/${world.c.routineId}`, headers: as("C") });
    expect(routine.statusCode).toBe(200);
  });

  it("AC16 — A is on the Hevy allow-list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hevy/status", headers: as("A") });
    expect(res.statusCode).toBe(200);
  });

  it("every table reachable from user by foreign keys is in the ownership map (Review Focus 2)", async () => {
    const reachable = await userReachableTables(db);
    expect(reachable.length).toBeGreaterThan(10);
    expect(Object.keys(OWNERSHIP_MAP).sort()).toEqual(reachable.sort());
  });

  it("a snapshot is stable when nothing changed", async () => {
    expect(await snapshot(db, world.b.userId)).toBe(await snapshot(db, world.b.userId));
  });
});
