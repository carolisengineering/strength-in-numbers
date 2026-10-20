import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ExportResultCode } from "@opentelemetry/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { PeriodicExportingMetricReader, type PushMetricExporter } from "@opentelemetry/sdk-metrics";
import { startTestTelemetry, stopTestTelemetry, type TelemetryHarness } from "../../helpers/telemetry.js";

const failingSpans: SpanExporter = {
  // The OTLP exporter's real error text names no signal (AC11: still reported as "traces").
  export: (_spans, cb) => cb({ code: ExportResultCode.FAILED, error: new Error("connect ECONNREFUSED 127.0.0.1:4318") }),
  shutdown: async () => {},
};
const throwingMetrics: PushMetricExporter = {
  export: () => {
    throw new Error("metric export exploded");
  },
  forceFlush: async () => {},
  shutdown: async () => {},
};

let h: TelemetryHarness;
let app: FastifyInstance;
let base: string;

beforeAll(async () => {
  h = startTestTelemetry({
    spanExporter: failingSpans,
    spanProcessor: "batch", // the production processor
    metricReader: new PeriodicExportingMetricReader({ exporter: throwingMetrics, exportIntervalMillis: 60_000 }),
  });
  const { buildTestApp } = await import("../../helpers/build-test-app.js");
  ({ app } = await buildTestApp());
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  await app?.close();
  await stopTestTelemetry(h).catch(() => {});
});

describe("AC11 — export failures never reach a request", () => {
  it("responses are normal while both exporters fail; failures are warned, throttled", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/v1/me`, { headers: { authorization: "Bearer test-token" } });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ email: "a@b.com" });
    }
    await h.handle.forceFlush().catch(() => {});
    await h.handle.forceFlush().catch(() => {});
    const signals = h.warnings.map((w) => (w[0] as { signal: string }).signal);
    expect(signals).toContain("traces");
    expect(signals).toContain("metrics");
    expect(signals.filter((s) => s === "traces")).toHaveLength(1);
    expect(signals.filter((s) => s === "metrics")).toHaveLength(1);
  });
});
