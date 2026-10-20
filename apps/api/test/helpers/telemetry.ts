import { MetricReader, type ResourceMetrics } from "@opentelemetry/sdk-metrics";

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
