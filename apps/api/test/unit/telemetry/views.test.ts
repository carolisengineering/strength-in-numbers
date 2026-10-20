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
