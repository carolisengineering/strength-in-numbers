import { context, diag, metrics, propagation, trace } from "@opentelemetry/api";
import { MetricReader, type ResourceMetrics } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { parseTelemetryEnv } from "../../src/telemetry/config.js";
import { startTelemetry, type TelemetryHandle } from "../../src/telemetry/sdk.js";

/** Pull-on-demand reader: `metricPoints()` calls `collect()`; nothing is exported. */
export class TestMetricReader extends MetricReader {
  protected override async onShutdown(): Promise<void> {}
  protected override async onForceFlush(): Promise<void> {}
}

export interface MetricPoint {
  attributes: Record<string, unknown>;
  value: unknown;
}

export async function metricPoints(reader: MetricReader, name: string): Promise<MetricPoint[]> {
  const { resourceMetrics } = (await reader.collect()) as { resourceMetrics: ResourceMetrics };
  return resourceMetrics.scopeMetrics
    .flatMap((s) => s.metrics)
    .filter((m) => m.descriptor.name === name)
    .flatMap((m) => m.dataPoints.map((d) => ({ attributes: { ...d.attributes }, value: d.value })));
}

/** Sum of counter points whose attributes include `attrs` (cumulative temporality). */
export function counterTotal(points: MetricPoint[], attrs: Record<string, unknown> = {}): number {
  return points
    .filter((p) => Object.entries(attrs).every(([k, v]) => p.attributes[k] === v))
    .reduce((n, p) => n + (p.value as number), 0);
}

export interface TelemetryHarness {
  spans: InMemorySpanExporter;
  reader: TestMetricReader;
  handle: TelemetryHandle;
  warnings: unknown[][];
}

/**
 * Starts the real SDK wiring with in-memory sinks. Call in `beforeAll` BEFORE
 * dynamically importing anything that loads Fastify (Global Constraints).
 */
export function startTestTelemetry(
  opts: { spanExporter?: SpanExporter; spanProcessor?: "simple" | "batch"; metricReader?: MetricReader; now?: () => number } = {},
): TelemetryHarness {
  const spans = new InMemorySpanExporter();
  const reader = new TestMetricReader();
  const warnings: unknown[][] = [];
  const { config } = parseTelemetryEnv({ OTEL_TRACES_SAMPLER: "always_on" });
  const handle = startTelemetry(config, {
    logger: { warn: (...args: unknown[]) => void warnings.push(args) },
    spanExporter: opts.spanExporter ?? spans,
    spanProcessor: opts.spanProcessor,
    metricReader: opts.metricReader ?? reader,
    now: opts.now,
  })!;
  return { spans, reader, handle, warnings };
}

export async function stopTestTelemetry(h: TelemetryHarness): Promise<void> {
  await h.handle.shutdown();
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
  diag.disable();
}
