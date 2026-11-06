import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { metrics } from "@opentelemetry/api";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { buildViews, METRIC_NAMES } from "../../../src/telemetry/views.js";
import {
  recordSetLogged,
  recordWorkoutFinished,
  recordWorkoutStarted,
  registerProcessStartTime,
} from "../../../src/telemetry/metrics.js";
import { TestMetricReader, metricPoints, counterTotal } from "../../helpers/telemetry.js";

let reader: TestMetricReader;
let provider: MeterProvider;

beforeEach(() => {
  reader = new TestMetricReader();
  provider = new MeterProvider({ readers: [reader], views: buildViews() });
  metrics.setGlobalMeterProvider(provider);
});
afterEach(async () => {
  await provider.shutdown();
  metrics.disable();
});

describe("AC8 — metric attribute allowlist", () => {
  it("strips attributes not listed for the HTTP duration histogram", async () => {
    const h = provider.getMeter("@opentelemetry/instrumentation-http").createHistogram("http.server.request.duration", { unit: "s" });
    h.record(0.05, {
      "http.request.method": "GET",
      "http.route": "/v1/workouts/:id",
      "http.response.status_code": 200,
      "url.path": "/v1/workouts/0190",
      "client.address": "203.0.113.9",
    });
    const points = await metricPoints(reader, METRIC_NAMES.httpDuration);
    expect(points).toHaveLength(1);
    expect(points[0]!.attributes).toEqual({
      "http.request.method": "GET",
      "http.route": "/v1/workouts/:id",
      "http.response.status_code": 200,
    });
  });

  it("drops instruments that have no View", async () => {
    provider.getMeter("x").createCounter("some.new.upstream.metric").add(1, { "user.id": "u" });
    const { resourceMetrics } = await reader.collect();
    const names = resourceMetrics.scopeMetrics.flatMap((s) => s.metrics.map((m) => m.descriptor.name));
    expect(names).not.toContain("some.new.upstream.metric");
  });
});

describe("Spec 13.0 §6.4 — business counters", () => {
  it("count with only the modality attribute", async () => {
    recordWorkoutStarted();
    recordWorkoutStarted();
    recordWorkoutFinished();
    recordSetLogged("weight_reps");
    expect(counterTotal(await metricPoints(reader, METRIC_NAMES.workoutsStarted))).toBe(2);
    expect(counterTotal(await metricPoints(reader, METRIC_NAMES.workoutsFinished))).toBe(1);
    const sets = await metricPoints(reader, METRIC_NAMES.setsLogged);
    expect(sets.map((p) => p.attributes)).toEqual([{ modality: "weight_reps" }]);
  });

  it("05.3 AC20 — a calories set carries modality: calories (a bounded enum, no allowlist change)", async () => {
    recordSetLogged("calories");
    const sets = await metricPoints(reader, METRIC_NAMES.setsLogged);
    expect(sets.map((p) => p.attributes)).toEqual([{ modality: "calories" }]);
  });

  it("re-bind to a newly registered global MeterProvider (no stale no-op instruments)", async () => {
    await provider.shutdown();
    metrics.disable();
    const reader2 = new TestMetricReader();
    const provider2 = new MeterProvider({ readers: [reader2], views: buildViews() });
    metrics.setGlobalMeterProvider(provider2);
    recordWorkoutStarted();
    expect(counterTotal(await metricPoints(reader2, METRIC_NAMES.workoutsStarted))).toBe(1);
    await provider2.shutdown();
    provider = new MeterProvider(); // keep afterEach's shutdown happy
  });

  it("registerProcessStartTime reports a constant gauge", async () => {
    registerProcessStartTime(provider.getMeter("sin-api"), 1_700_000_000);
    const points = await metricPoints(reader, METRIC_NAMES.processStart);
    expect(points).toEqual([{ attributes: {}, value: 1_700_000_000 }]);
  });
});

describe("Spec 13.3 AC9 — runtime-pressure Views keep only their attribute", () => {
  it("the CPU counter exports only cpu.mode", async () => {
    provider
      .getMeter("sin-api")
      .createObservableCounter("sin.process.cpu.time", { unit: "s" })
      .addCallback((r) => r.observe(1, { "cpu.mode": "user", pid: 1 }));
    expect(await metricPoints(reader, METRIC_NAMES.processCpu)).toEqual([{ attributes: { "cpu.mode": "user" }, value: 1 }]);
  });

  it("the throttling counter exports no attributes", async () => {
    provider
      .getMeter("sin-api")
      .createObservableCounter("sin.container.cpu.throttled", { unit: "s" })
      .addCallback((r) => r.observe(2, { "container.id": "abc" }));
    expect(await metricPoints(reader, METRIC_NAMES.cpuThrottled)).toEqual([{ attributes: {}, value: 2 }]);
  });
});

describe("Spec 13.3 AC9 — pool Views keep only their attribute", () => {
  it("the connections gauge exports only state", async () => {
    provider
      .getMeter("sin-api")
      .createObservableGauge("sin.db.pool.connections")
      .addCallback((r) => r.observe(3, { state: "busy", host: "x" }));
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolConnections)).toEqual([{ attributes: { state: "busy" }, value: 3 }]);
  });

  it("the other pool instruments export no attributes", async () => {
    const m = provider.getMeter("sin-api");
    m.createObservableGauge("sin.db.pool.waiting").addCallback((r) => r.observe(1, { host: "x" }));
    m.createObservableGauge("sin.db.pool.limit").addCallback((r) => r.observe(8, { host: "x" }));
    m.createObservableCounter("sin.db.pool.wait", { unit: "s" }).addCallback((r) => r.observe(0.5, { host: "x" }));
    m.createObservableCounter("sin.db.pool.waits").addCallback((r) => r.observe(4, { host: "x" }));
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolWaiting)).toEqual([{ attributes: {}, value: 1 }]);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolLimit)).toEqual([{ attributes: {}, value: 8 }]);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolWaitSeconds)).toEqual([{ attributes: {}, value: 0.5 }]);
    expect(await metricPoints(reader, METRIC_NAMES.dbPoolWaits)).toEqual([{ attributes: {}, value: 4 }]);
  });
});
