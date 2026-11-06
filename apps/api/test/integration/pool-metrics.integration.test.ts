import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { poolMetricsSource } from "../../src/db.js";
import { METRIC_NAMES } from "../../src/telemetry/views.js";
import { metricPoints, startTestTelemetry, stopTestTelemetry, type TelemetryHarness } from "../helpers/telemetry.js";
import { shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 13.3 AC7 — reading the pool metrics costs no SQL and opens no connection. `$metrics.json()` would start
 * Prisma's engine (and connect), so the source is gated on the engine having started; these cases prove the gate
 * against a real Postgres. The cases run in order on one client.
 */
describe.skipIf(!shouldRunIntegration())("Spec 13.3 — pool metrics on real Postgres", () => {
  let db: IntegrationDb;
  let checker: PrismaClient;
  let h: TelemetryHarness;
  const queries: string[] = [];
  let jsonCalls = 0;

  /** Client sessions on the test database other than the checker's own. */
  const sessions = async (): Promise<number> =>
    (
      await checker.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = 'sin_test' AND backend_type = 'client backend' AND pid <> pg_backend_pid()`
    )[0]!.n;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    // One connection, so `pid <> pg_backend_pid()` excludes every session of the checker's own.
    checker = new PrismaClient({ datasourceUrl: `${db.url}${db.url.includes("?") ? "&" : "?"}connection_limit=1` });
    await checker.$queryRaw`SELECT 1`;
    db.prisma.$on("query" as never, (e: { query: string }) => void queries.push(e.query));
    h = startTestTelemetry();
    const real = poolMetricsSource(db.prisma);
    h.handle.registerDbPool(
      {
        engineStarted: real.engineStarted,
        json: () => {
          jsonCalls += 1;
          return real.json();
        },
      },
      8,
    );
  }, 120_000);

  afterAll(async () => {
    if (!shouldRunIntegration()) return;
    await stopTestTelemetry(h);
    await checker?.$disconnect();
    await db?.stop();
  });

  it("AC7 — an idle client: two collections issue no SQL and open no session", async () => {
    expect(await metricPoints(h.reader, METRIC_NAMES.dbPoolConnections)).toEqual([]);
    expect(await metricPoints(h.reader, METRIC_NAMES.dbPoolConnections)).toEqual([]);
    expect(queries).toEqual([]);
    expect(jsonCalls).toBe(0);
    expect(await sessions()).toBe(0);
  });

  it("AC7 — after the first query the pool series appear, and collecting adds no SQL", async () => {
    await db.prisma.$queryRaw`SELECT 1`;
    queries.length = 0;
    const points = await metricPoints(h.reader, METRIC_NAMES.dbPoolConnections);
    const busy = points.find((p) => p.attributes["state"] === "busy")?.value as number;
    const idle = points.find((p) => p.attributes["state"] === "idle")?.value as number;
    expect(points).toHaveLength(2);
    expect(busy + idle).toBeGreaterThanOrEqual(1);
    expect(queries).toEqual([]);
  });

  it("AC7 — no reconnect after $disconnect (Review Focus 2)", async () => {
    await db.prisma.$disconnect();
    const deadline = Date.now() + 2_000;
    while ((await sessions()) > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(await sessions()).toBe(0);
    // With cumulative temporality the SDK keeps exporting an async gauge's last value, so "no series" can't be
    // seen in the export; what matters is that the collection does not read $metrics (which would restart the
    // engine and reconnect).
    jsonCalls = 0;
    await metricPoints(h.reader, METRIC_NAMES.dbPoolConnections);
    expect(jsonCalls, "$metrics.json() calls after $disconnect").toBe(0);
    await new Promise((r) => setTimeout(r, 200));
    expect(await sessions(), "sessions after a post-disconnect collection").toBe(0);
  });
});
