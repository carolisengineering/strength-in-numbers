import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { buildViews, METRIC_NAMES } from "../../../src/telemetry/views.js";
import { readPoolNumbers, registerDbPoolMetrics, type PoolMetricsSource } from "../../../src/telemetry/db-pool.js";
import { registerRuntimePressureMetrics } from "../../../src/telemetry/runtime-pressure.js";
import {
  TestMetricReader,
  metricPoints,
  startTestTelemetry,
  stopTestTelemetry,
  type TelemetryHarness,
} from "../../helpers/telemetry.js";

type Metric = { key: string; value: unknown };
type MetricsJson = { counters: Metric[]; gauges: Metric[]; histograms: Metric[] };

/** Recorded from Prisma 6.19.3 on Postgres 16 (Spec 13.3 plan Task 1). */
const FIXTURE: MetricsJson = JSON.parse(
  readFileSync(new URL("./fixtures/prisma-metrics-6.19.3.json", import.meta.url), "utf8"),
) as MetricsJson;
const fixture = (): MetricsJson => structuredClone(FIXTURE);
const gauge = (json: MetricsJson, key: string) => json.gauges.find((m) => m.key === key)!.value as number;
const waitHistogram = (json: MetricsJson) =>
  json.histograms.find((m) => m.key === "prisma_client_queries_wait_histogram_ms")!.value as { sum: number; count: number };

let reader: TestMetricReader;
let provider: MeterProvider;
const meter = () => provider.getMeter("sin-api");

beforeEach(() => {
  reader = new TestMetricReader();
  provider = new MeterProvider({ readers: [reader], views: buildViews() });
});
afterEach(async () => {
  await provider.shutdown();
});

function fakeSource(json: () => unknown, started = true) {
  const state = { started };
  const source: PoolMetricsSource & { json: ReturnType<typeof vi.fn> } = {
    engineStarted: () => state.started,
    json: vi.fn(async () => json()),
  };
  return { source, state };
}

describe("AC4 — pool gauges from the Prisma metrics source", () => {
  it("exports busy and idle connections and the waiting queue", async () => {
    const { source } = fakeSource(fixture);
    registerDbPoolMetrics(meter(), source, 8, vi.fn());
    const connections = await metricPoints(reader, METRIC_NAMES.dbPoolConnections);
    expect(connections).toHaveLength(2);
    expect(connections).toEqual(
      expect.arrayContaining([
        { attributes: { state: "busy" }, value: gauge(FIXTURE, "prisma_pool_connections_busy") },
        { attributes: { state: "idle" }, value: gauge(FIXTURE, "prisma_pool_connections_idle") },
      ]),
    );
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolWaiting)).toEqual([
      { attributes: {}, value: gauge(FIXTURE, "prisma_client_queries_wait") },
    ]);
  });
});

describe("AC5 — cumulative wait counters", () => {
  it("wait seconds is the histogram sum in seconds, waits its count; neither decreases", async () => {
    let json = fixture();
    const { source } = fakeSource(() => json);
    registerDbPoolMetrics(meter(), source, 8, vi.fn());
    const { sum, count } = waitHistogram(FIXTURE);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolWaitSeconds)).toEqual([{ attributes: {}, value: sum / 1000 }]);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolWaits)).toEqual([{ attributes: {}, value: count }]);

    json = fixture();
    waitHistogram(json).sum = sum + 500;
    waitHistogram(json).count = count + 3;
    const seconds = (await metricPoints(reader, METRIC_NAMES.dbPoolWaitSeconds))[0]!.value as number;
    const waits = (await metricPoints(reader, METRIC_NAMES.dbPoolWaits))[0]!.value as number;
    expect(seconds).toBeCloseTo((sum + 500) / 1000, 9);
    expect(seconds).toBeGreaterThanOrEqual(sum / 1000);
    expect(waits).toBe(count + 3);
  });
});

describe("AC6 — the limit is exported", () => {
  it("8 → 8", async () => {
    registerDbPoolMetrics(meter(), fakeSource(fixture).source, 8, vi.fn());
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolLimit)).toEqual([{ attributes: {}, value: 8 }]);
  });
  it("undefined → no series", async () => {
    registerDbPoolMetrics(meter(), fakeSource(fixture).source, undefined, vi.fn());
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolLimit)).toEqual([]);
  });
  it("NaN → no series", async () => {
    registerDbPoolMetrics(meter(), fakeSource(fixture).source, Number.NaN, vi.fn());
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolLimit)).toEqual([]);
  });
});

describe("AC7 — engine gate", () => {
  it("does not read metrics before the engine started; series appear once it has", async () => {
    const { source, state } = fakeSource(fixture, false);
    registerDbPoolMetrics(meter(), source, 8, vi.fn());
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolConnections)).toEqual([]);
    expect(source.json).not.toHaveBeenCalled();
    state.started = true;
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolConnections)).toHaveLength(2);
    expect(source.json).toHaveBeenCalled();
  });
});

describe("AC8 — failure isolation", () => {
  it("a rejecting source observes nothing and reports", async () => {
    const report = vi.fn();
    const source: PoolMetricsSource = { engineStarted: () => true, json: () => Promise.reject(new Error("engine gone")) };
    registerDbPoolMetrics(meter(), source, 8, report);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolConnections)).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0]![0])).toContain("engine gone");
  });

  it("an unexpected shape observes nothing and reports", async () => {
    const report = vi.fn();
    registerDbPoolMetrics(meter(), fakeSource(() => "junk").source, 8, report);
    const { resourceMetrics } = await reader.collect();
    const poolPoints = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .filter((m) => m.descriptor.name.startsWith("sin_db_pool_") && m.descriptor.name !== METRIC_NAMES.dbPoolLimit)
      .flatMap((m) => m.dataPoints as unknown[]);
    expect(poolPoints).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("Review Focus 1 — a missing key skips only its instruments, without a warning", async () => {
    const report = vi.fn();
    const json = fixture();
    json.histograms = json.histograms.filter((m) => m.key !== "prisma_client_queries_wait_histogram_ms");
    registerDbPoolMetrics(meter(), fakeSource(() => json).source, 8, report);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolConnections)).toHaveLength(2);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolWaiting)).toHaveLength(1);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolWaitSeconds)).toEqual([]);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolWaits)).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("Review Focus 5 — with no metric reader, json() is never called", async () => {
    const lonely = new MeterProvider({ views: buildViews() });
    const { source } = fakeSource(fixture);
    registerDbPoolMetrics(lonely.getMeter("sin-api"), source, 8, vi.fn());
    await lonely.forceFlush();
    await lonely.shutdown();
    expect(source.json).not.toHaveBeenCalled();
  });
});

describe("AC8 — through the SDK's throttled reporter", () => {
  let h: TelemetryHarness;
  let t = 1_000_000;
  beforeEach(() => {
    h = startTestTelemetry({ now: () => t });
  });
  afterEach(async () => {
    await stopTestTelemetry(h);
  });

  it("two failing collections inside 5 minutes give one warn with signal metrics", async () => {
    h.handle.registerDbPool({ engineStarted: () => true, json: () => Promise.reject(new Error("engine gone")) }, 8);
    await metricPoints(h.reader, METRIC_NAMES.dbPoolConnections);
    t += 60_000;
    await metricPoints(h.reader, METRIC_NAMES.dbPoolConnections);
    const poolWarnings = h.warnings.filter((w) => String(w[1]).includes("engine gone"));
    expect(poolWarnings).toHaveLength(1);
    expect(poolWarnings[0]![0]).toMatchObject({ signal: "metrics" });
  });
});

describe("AC10 — bounded cardinality", () => {
  it("all new instruments together export exactly 9 series", async () => {
    registerRuntimePressureMetrics(meter(), {
      report: vi.fn(),
      cpuUsage: () => ({ user: 1, system: 1 }),
      readCpuStat: () => "throttled_usec 5\n",
    });
    registerDbPoolMetrics(meter(), fakeSource(fixture).source, 8, vi.fn());
    const names = [
      METRIC_NAMES.processCpu,
      METRIC_NAMES.cpuThrottled,
      METRIC_NAMES.dbPoolConnections,
      METRIC_NAMES.dbPoolWaiting,
      METRIC_NAMES.dbPoolLimit,
      METRIC_NAMES.dbPoolWaitSeconds,
      METRIC_NAMES.dbPoolWaits,
    ];
    const { resourceMetrics } = await reader.collect();
    const count = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .filter((m) => (names as string[]).includes(m.descriptor.name))
      .reduce((n, m) => n + m.dataPoints.length, 0);
    expect(count).toBe(9);
  });
});

describe("readPoolNumbers", () => {
  it("returns undefined only for a wrong top-level shape", () => {
    expect(readPoolNumbers("junk")).toBeUndefined();
    expect(readPoolNumbers({ counters: [], gauges: [] })).toBeUndefined();
    expect(readPoolNumbers({ counters: [], gauges: [], histograms: [] })).toEqual({});
  });
});
