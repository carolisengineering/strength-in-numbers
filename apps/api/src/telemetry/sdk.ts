import { diag, DiagLogLevel, metrics, type Span } from "@opentelemetry/api";
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
import { ExportResultCode } from "@opentelemetry/core";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import type { TelemetryConfig } from "./config.js";
import { AllowlistSpanProcessor } from "./allowlist.js";
import { buildViews } from "./views.js";
import { registerProcessStartTime } from "./metrics.js";
import { createThrottledReporter, errorText, type WarnSink } from "./diag.js";

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

/**
 * AC11 — reports a failed span export as "traces". The batch processor hands
 * the exporter's raw error (e.g. "connect ECONNREFUSED …") to the global error
 * handler, and that text names no signal; `reported` lets the handler skip it.
 * #121: the text names an `AggregateError`'s inner errors, and a result with
 * no error is passed on carrying the one reported here, so the processor
 * doesn't make its own and report the same failure again.
 */
export function reportingSpanExporter(
  inner: SpanExporter,
  report: (message: string, err: unknown) => void,
  reported: WeakSet<object>,
): SpanExporter {
  return {
    export: (spans, done) =>
      inner.export(spans, (result) => {
        if (result.code !== ExportResultCode.SUCCESS) {
          const err = result.error ?? new Error("span export failed with no error");
          reported.add(err);
          report(`span export failed: ${errorText(err)}`, err);
          done(result.error ? result : { ...result, error: err });
          return;
        }
        done(result);
      }),
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
  };
}

/**
 * §8 — `always_on` / `always_off` ignore an inbound `traceparent`'s sampled
 * flag; only `parentbased_traceidratio` follows the remote parent. With traces
 * off the provider still exists (context propagation) but samples nothing.
 */
export function buildSampler(
  traces: Pick<TelemetryConfig["traces"], "sampler" | "samplerRatio">,
  tracingOn: boolean,
): Sampler {
  if (!tracingOn || traces.sampler === "always_off") return new AlwaysOffSampler();
  if (traces.sampler === "always_on") return new AlwaysOnSampler();
  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(traces.samplerRatio) });
}

const pathOf = (url: string | undefined): string => {
  const raw = url ?? "/";
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
};

/** AC4: both instrumentations skip the health paths, compared without the query string (#122). */
export const isIgnoredUrl = (url: string | undefined): boolean => IGNORED_PATHS.has(pathOf(url));

/** The two instrumentations' ignore hooks, exported so a test can call each one (#122). */
export const IGNORE_HOOKS = {
  http: (req: { url?: string }): boolean => isIgnoredUrl(req.url),
  fastify: (opts: { url: string }): boolean => isIgnoredUrl(opts.url),
} as const;

/**
 * Spec 13.0 §7, #128 — the per-request id (already in every log line: a valid
 * client X-Request-Id, else a random UUID, `genReqId` in app.ts) on the request
 * span, so a trace can be found from a log line and vice versa. Only an
 * instrumented app calls it; a telemetry-off app has no hook at all.
 */
export const stampRequestId = (span: Pick<Span, "setAttribute">, request: { id: string }): void => {
  span.setAttribute("sin.request_id", request.id);
};

/**
 * #120 — the dev-only `/metrics` server listens on `config.prometheusHost`
 * (loopback unless overridden), never every interface. Its own start is
 * awaited here, so a taken port is one clear metrics `warn` naming the
 * address, not a diag error with no signal.
 */
export function startPrometheus(
  metricsConfig: TelemetryConfig["metrics"],
  report: (message: string, err: unknown) => void,
): PrometheusExporter {
  const { prometheusHost: host, prometheusPort: port } = metricsConfig;
  const exporter = new PrometheusExporter({ host, port, endpoint: "/metrics", preventServerStart: true });
  exporter.startServer().catch((err: unknown) => {
    report(`Prometheus /metrics could not listen on ${host}:${port} (${errorText(err)}); no metrics are served`, err);
  });
  return exporter;
}

export function startTelemetry(config: TelemetryConfig, deps: StartTelemetryDeps): TelemetryHandle | undefined {
  if (!config.enabled && !deps.spanExporter && !deps.metricReader) return undefined;

  // Departure 9: stable HTTP semconv (http.server.request.duration in seconds,
  // http.route / url.* attributes) regardless of the instrumentation's default.
  process.env.OTEL_SEMCONV_STABILITY_OPT_IN ??= "http";

  const reporter = createThrottledReporter(deps.logger, { now: deps.now });
  diag.setLogger(reporter.diagLogger, DiagLogLevel.WARN);
  const reportedSpanErrors = new WeakSet<object>();
  setGlobalErrorHandler((err) => {
    if (typeof err === "object" && err !== null && reportedSpanErrors.has(err)) return;
    reporter.report(errorText(err), err);
  });

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
    const exporter = reportingSpanExporter(
      traceExporter,
      (message, err) => reporter.report(message, err, "traces"),
      reportedSpanErrors,
    );
    const inner = kind === "simple" ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter);
    spanProcessors.push(new AllowlistSpanProcessor(inner));
  }
  const tracerProvider = new NodeTracerProvider({
    resource,
    sampler: buildSampler(config.traces, traceExporter !== undefined),
    spanProcessors,
  });
  tracerProvider.register();

  // Metrics.
  const reader: MetricReader | undefined =
    deps.metricReader ??
    (config.metrics.exporter === "prometheus"
      ? startPrometheus(config.metrics, (message, err) => reporter.report(message, err, "metrics"))
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
        ignoreIncomingRequestHook: IGNORE_HOOKS.http,
        disableOutgoingRequestInstrumentation: true, // JWKS fetches are noise (§6.2)
      }),
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        ignorePaths: IGNORE_HOOKS.fastify,
        requestHook: stampRequestId,
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
