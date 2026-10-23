/**
 * Spec 13.0 §8 — telemetry env parsing. Pure: returns issues instead of throwing
 * so `loadConfig` can merge them into its own ConfigError (no import cycle with
 * config.ts). Unset = off (AC1) — deliberately unlike the OTel SDK, which treats
 * an unset exporter variable as "otlp" (D14).
 */
export type MetricsExporterKind = "prometheus" | "otlp" | "none";
export type TracesExporterKind = "otlp" | "none";

export interface TelemetryConfig {
  /** Metrics or traces exporter is not "none". */
  readonly enabled: boolean;
  /** `Config.serviceName`, passed in by `loadConfig`: the same value as the log `service` field (D17, #127). */
  readonly serviceName: string;
  /** SERVICE_VERSION ?? RENDER_GIT_COMMIT. */
  readonly serviceVersion: string | undefined;
  /** `deployment.environment` from OTEL_RESOURCE_ATTRIBUTES. */
  readonly environment: string | undefined;
  readonly metrics: {
    readonly exporter: MetricsExporterKind;
    /** OTEL_EXPORTER_PROMETHEUS_PORT, default 9464. */
    readonly prometheusPort: number;
    /** Full URL including /v1/metrics. */
    readonly otlpUrl: string | undefined;
    /** OTEL_METRIC_EXPORT_INTERVAL, default 60000. */
    readonly exportIntervalMs: number;
  };
  readonly traces: {
    readonly exporter: TracesExporterKind;
    /** Full URL including /v1/traces. */
    readonly otlpUrl: string | undefined;
    /** OTEL_TRACES_SAMPLER; always_on / always_off ignore the remote parent. */
    readonly sampler: SamplerKind;
    /** 0..1 */
    readonly samplerRatio: number;
  };
  readonly otlpHeaders: Readonly<Record<string, string>>;
}

const METRICS_EXPORTERS: readonly MetricsExporterKind[] = ["prometheus", "otlp", "none"];
const TRACES_EXPORTERS: readonly TracesExporterKind[] = ["otlp", "none"];
const SAMPLERS = ["parentbased_traceidratio", "always_on", "always_off"] as const;
export type SamplerKind = (typeof SAMPLERS)[number];

const str = (env: Record<string, unknown>, key: string): string | undefined => {
  const v = env[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};

const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/** `k=v,k2=v2`; split on the FIRST '=' (base64 padding), URL-decode values. */
function parseKeyValueList(raw: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) return undefined;
    const key = part.slice(0, i).trim();
    if (key === "") return undefined;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return undefined;
    }
  }
  return out;
}

/** The SERVICE_NAME default, shared with `Config`'s schema. */
export const DEFAULT_SERVICE_NAME = "si-api";

/** `serviceName` comes from `Config` (#127); this parser never reads SERVICE_NAME itself. */
export function parseTelemetryEnv(
  env: Record<string, unknown>,
  serviceName: string = DEFAULT_SERVICE_NAME,
): { config: TelemetryConfig; issues: string[] } {
  const issues: string[] = [];

  const metricsExporter = (str(env, "OTEL_METRICS_EXPORTER") ?? "none") as MetricsExporterKind;
  if (!METRICS_EXPORTERS.includes(metricsExporter)) {
    issues.push(`OTEL_METRICS_EXPORTER: must be one of ${METRICS_EXPORTERS.join(", ")}`);
  }
  const tracesExporter = (str(env, "OTEL_TRACES_EXPORTER") ?? "none") as TracesExporterKind;
  if (!TRACES_EXPORTERS.includes(tracesExporter)) {
    issues.push(`OTEL_TRACES_EXPORTER: must be one of ${TRACES_EXPORTERS.join(", ")}`);
  }
  if (metricsExporter === "prometheus" && env.NODE_ENV === "production") {
    issues.push("OTEL_METRICS_EXPORTER: prometheus is not allowed in production (use otlp)");
  }

  const base = str(env, "OTEL_EXPORTER_OTLP_ENDPOINT");
  if (base !== undefined && !isHttpUrl(base)) {
    issues.push("OTEL_EXPORTER_OTLP_ENDPOINT: must be an http(s) URL");
  }
  const signalUrl = (perSignalKey: string, path: string): string | undefined => {
    const own = str(env, perSignalKey);
    if (own !== undefined) {
      if (!isHttpUrl(own)) issues.push(`${perSignalKey}: must be an http(s) URL`);
      return own;
    }
    return base !== undefined && isHttpUrl(base) ? `${base.replace(/\/+$/, "")}${path}` : undefined;
  };
  const metricsUrl = signalUrl("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "/v1/metrics");
  const tracesUrl = signalUrl("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "/v1/traces");
  if (metricsExporter === "otlp" && metricsUrl === undefined && base === undefined) {
    issues.push("OTEL_EXPORTER_OTLP_ENDPOINT: is required when OTEL_METRICS_EXPORTER=otlp");
  }
  if (tracesExporter === "otlp" && tracesUrl === undefined && base === undefined) {
    issues.push("OTEL_EXPORTER_OTLP_ENDPOINT: is required when OTEL_TRACES_EXPORTER=otlp");
  }

  let otlpHeaders: Record<string, string> = {};
  const rawHeaders = str(env, "OTEL_EXPORTER_OTLP_HEADERS");
  if (rawHeaders !== undefined) {
    const parsed = parseKeyValueList(rawHeaders);
    // Never echo the value: it carries the Grafana Cloud token (§7).
    if (parsed === undefined) issues.push("OTEL_EXPORTER_OTLP_HEADERS: must be a comma-separated key=value list");
    else otlpHeaders = parsed;
  }

  const rawSampler = str(env, "OTEL_TRACES_SAMPLER") ?? "parentbased_traceidratio";
  const sampler: SamplerKind = (SAMPLERS as readonly string[]).includes(rawSampler)
    ? (rawSampler as SamplerKind)
    : "parentbased_traceidratio";
  let samplerRatio = 1;
  if (sampler !== rawSampler) {
    issues.push(`OTEL_TRACES_SAMPLER: must be one of ${SAMPLERS.join(", ")}`);
  } else if (sampler === "always_off") {
    samplerRatio = 0;
  } else if (sampler === "parentbased_traceidratio") {
    const arg = str(env, "OTEL_TRACES_SAMPLER_ARG");
    if (arg !== undefined) {
      const n = Number(arg);
      if (!Number.isFinite(n) || n < 0 || n > 1) issues.push("OTEL_TRACES_SAMPLER_ARG: must be a number in [0, 1]");
      else samplerRatio = n;
    }
  }

  const port = Number(str(env, "OTEL_EXPORTER_PROMETHEUS_PORT") ?? "9464");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push("OTEL_EXPORTER_PROMETHEUS_PORT: must be an integer between 1 and 65535");
  }
  const interval = Number(str(env, "OTEL_METRIC_EXPORT_INTERVAL") ?? "60000");
  if (!Number.isInteger(interval) || interval < 1000) {
    issues.push("OTEL_METRIC_EXPORT_INTERVAL: must be an integer number of ms ≥ 1000");
  }

  const rawResource = str(env, "OTEL_RESOURCE_ATTRIBUTES");
  let resourceAttrs: Record<string, string> = {};
  if (rawResource !== undefined) {
    const parsed = parseKeyValueList(rawResource);
    if (parsed === undefined) issues.push("OTEL_RESOURCE_ATTRIBUTES: must be a comma-separated key=value list");
    else resourceAttrs = parsed;
  }

  return {
    issues,
    config: Object.freeze({
      enabled: metricsExporter !== "none" || tracesExporter !== "none",
      serviceName,
      serviceVersion: str(env, "SERVICE_VERSION") ?? str(env, "RENDER_GIT_COMMIT"),
      environment: resourceAttrs["deployment.environment"],
      metrics: Object.freeze({
        exporter: metricsExporter,
        prometheusPort: port,
        otlpUrl: metricsUrl,
        exportIntervalMs: interval,
      }),
      traces: Object.freeze({ exporter: tracesExporter, otlpUrl: tracesUrl, sampler, samplerRatio }),
      otlpHeaders: Object.freeze(otlpHeaders),
    }),
  };
}
