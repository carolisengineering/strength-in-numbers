import { diag, DiagLogLevel, metrics } from "@opentelemetry/api";
import { setGlobalErrorHandler } from "@opentelemetry/core";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { FastifyOtelInstrumentation } from "@fastify/otel";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { MeterProvider, PeriodicExportingMetricReader, type MetricReader } from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  AlwaysOffSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import type { TelemetryConfig } from "./config.js";
import { AllowlistSpanProcessor } from "./allowlist.js";
import { buildViews } from "./views.js";
import { registerProcessStartTime } from "./metrics.js";
import { createThrottledReporter, type WarnSink } from "./diag.js";

/**
 * Spec 13.0 §6.1–§6.7 — explicit providers from our parsed config (D14), never
 * the SDK's env defaults. Must run before Fastify is imported (main.ts, D15).
 */
export interface TelemetryHandle {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface StartTelemetryDeps {
  logger: WarnSink;
  spanExporter?: SpanExporter;
  spanProcessor?: "simple" | "batch";
  metricReader?: MetricReader;
  now?: () => number;
}

/** AC4 — not measured, not traced. `/metrics` is the Prometheus exporter's own server (Review Focus 3). */
export const IGNORED_PATHS: ReadonlySet<string> = new Set(["/healthz", "/readyz", "/metrics"]);

const pathOf = (url: string | undefined): string => {
  const raw = url ?? "/";
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
};

export function startTelemetry(config: TelemetryConfig, deps: StartTelemetryDeps): TelemetryHandle | undefined {
  if (!config.enabled && !deps.spanExporter && !deps.metricReader) return undefined;

  // Departure 9: stable HTTP semconv (http.server.request.duration in seconds,
  // http.route / url.* attributes) regardless of the instrumentation's default.
  process.env.OTEL_SEMCONV_STABILITY_OPT_IN ??= "http";

  const reporter = createThrottledReporter(deps.logger, { now: deps.now });
  diag.setLogger(reporter.diagLogger, DiagLogLevel.WARN);
  setGlobalErrorHandler((err) => reporter.report(err instanceof Error ? err.message : String(err), err));

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    ...(config.serviceVersion ? { [ATTR_SERVICE_VERSION]: config.serviceVersion } : {}),
    ...(config.environment ? { "deployment.environment": config.environment } : {}),
  });

  // Traces. A provider is ALWAYS registered (departure 10): its context manager
  // carries @fastify/otel's route into instrumentation-http's duration metric.
  const traceExporter: SpanExporter | undefined =
    deps.spanExporter ??
    (config.traces.exporter === "otlp"
      ? new OTLPTraceExporter({ url: config.traces.otlpUrl, headers: { ...config.otlpHeaders } })
      : undefined);
  const spanProcessors: SpanProcessor[] = [];
  if (traceExporter) {
    const kind = deps.spanProcessor ?? (deps.spanExporter ? "simple" : "batch");
    const inner = kind === "simple" ? new SimpleSpanProcessor(traceExporter) : new BatchSpanProcessor(traceExporter);
    spanProcessors.push(new AllowlistSpanProcessor(inner));
  }
  const tracerProvider = new NodeTracerProvider({
    resource,
    sampler: traceExporter
      ? new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.traces.samplerRatio) })
      : new AlwaysOffSampler(),
    spanProcessors,
  });
  tracerProvider.register();

  // Metrics.
  const reader: MetricReader | undefined =
    deps.metricReader ??
    (config.metrics.exporter === "prometheus"
      ? new PrometheusExporter({ port: config.metrics.prometheusPort, endpoint: "/metrics" })
      : config.metrics.exporter === "otlp"
        ? new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({ url: config.metrics.otlpUrl, headers: { ...config.otlpHeaders } }),
            exportIntervalMillis: config.metrics.exportIntervalMs,
          })
        : undefined);
  const meterProvider = new MeterProvider({ resource, readers: reader ? [reader] : [], views: buildViews() });
  metrics.setGlobalMeterProvider(meterProvider);
  registerProcessStartTime(meterProvider.getMeter("sin-api"));

  const unload = registerInstrumentations({
    tracerProvider,
    meterProvider,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => IGNORED_PATHS.has(pathOf(req.url)),
        disableOutgoingRequestInstrumentation: true, // JWKS fetches are noise (§6.2)
      }),
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        ignorePaths: (opts: { url: string }) => IGNORED_PATHS.has(opts.url),
      }),
      new PrismaInstrumentation({
        ignoreSpanTypes: ["prisma:client:serialize", "prisma:engine:serialize", "prisma:engine:response_json_serialization"],
      }),
      new RuntimeNodeInstrumentation(),
    ],
  });

  return {
    forceFlush: async () => {
      await Promise.all([tracerProvider.forceFlush(), meterProvider.forceFlush()]);
    },
    shutdown: async () => {
      try {
        await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
      } finally {
        unload();
      }
    },
  };
}
