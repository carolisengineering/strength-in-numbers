import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { connectionLimitOf, poolMetricsSource, resolveDatabaseUrl, wirePoolMetrics } from "../../src/db.js";
import type { TelemetryHandle } from "../../src/telemetry/sdk.js";

describe("AC6 — connectionLimitOf", () => {
  it("reads the backfilled 8", () => {
    expect(connectionLimitOf(resolveDatabaseUrl("postgresql://u:p@h/db"))).toBe(8);
  });
  it("reads an explicit limit (Review Focus 4)", () => {
    expect(connectionLimitOf(resolveDatabaseUrl("postgresql://u:p@h/db?connection_limit=20"))).toBe(20);
  });
  it("non-numeric, zero and missing give undefined", () => {
    expect(connectionLimitOf(resolveDatabaseUrl("postgresql://u:p@h/db?connection_limit=abc"))).toBeUndefined();
    expect(connectionLimitOf(resolveDatabaseUrl("postgresql://u:p@h/db?connection_limit=0"))).toBeUndefined();
    expect(connectionLimitOf("postgresql://u:p@h/db")).toBeUndefined();
  });
});

describe("AC1 — off by default", () => {
  it("with no telemetry handle nothing is registered and $metrics is never read", () => {
    const json = vi.fn();
    const fakePrisma = { $metrics: { json }, _engine: { libraryStarted: true } } as unknown as PrismaClient;
    expect(wirePoolMetrics(undefined, fakePrisma, "postgresql://u:p@h/db")).toBe(false);
    expect(json).not.toHaveBeenCalled();
  });

  it("with a handle it registers the source and the resolved limit", () => {
    const registerDbPool = vi.fn();
    const handle = { forceFlush: vi.fn(), shutdown: vi.fn(), registerDbPool } as unknown as TelemetryHandle;
    const fakePrisma = { $metrics: { json: vi.fn() }, _engine: { libraryStarted: false } } as unknown as PrismaClient;
    expect(wirePoolMetrics(handle, fakePrisma, "postgresql://u:p@h/db?connection_limit=12")).toBe(true);
    expect(registerDbPool).toHaveBeenCalledWith(expect.objectContaining({ engineStarted: expect.any(Function) }), 12);
  });
});

describe("AC7 — engine gate", () => {
  const client = new PrismaClient({ datasourceUrl: "postgresql://u:p@127.0.0.1:1/x" });
  afterAll(async () => {
    await client.$disconnect();
  });

  it("an unqueried real client reports the engine as not started", () => {
    expect(poolMetricsSource(client).engineStarted()).toBe(false);
  });

  it("an engine without the field reads as not started", () => {
    expect(poolMetricsSource({ _engine: {} } as unknown as PrismaClient).engineStarted()).toBe(false);
    expect(poolMetricsSource({} as unknown as PrismaClient).engineStarted()).toBe(false);
  });

  it("json() reads $metrics.json", async () => {
    const json = vi.fn(async () => ({ counters: [], gauges: [], histograms: [] }));
    await poolMetricsSource({ $metrics: { json } } as unknown as PrismaClient).json();
    expect(json).toHaveBeenCalledTimes(1);
  });
});
