import { describe, it, expect } from "vitest";
import { parseTelemetryEnv } from "../../../src/telemetry/config.js";

const ok = (env: Record<string, string>) => {
  const r = parseTelemetryEnv(env);
  expect(r.issues).toEqual([]);
  return r.config;
};
const issuesFor = (env: Record<string, string>) => parseTelemetryEnv(env).issues;

describe("AC1 — telemetry is off when nothing is set", () => {
  it("defaults every exporter to none", () => {
    const c = ok({});
    expect(c.enabled).toBe(false);
    expect(c.metrics.exporter).toBe("none");
    expect(c.traces.exporter).toBe("none");
    expect(c.serviceName).toBe("si-api");
    expect(c.metrics.prometheusPort).toBe(9464);
    expect(c.metrics.exportIntervalMs).toBe(60_000);
    expect(c.traces.samplerRatio).toBe(1);
  });
});

describe("AC2 — fail-fast telemetry config", () => {
  it.each([
    [{ OTEL_METRICS_EXPORTER: "console" }, "OTEL_METRICS_EXPORTER"],
    [{ OTEL_TRACES_EXPORTER: "zipkin" }, "OTEL_TRACES_EXPORTER"],
    [{ OTEL_TRACES_EXPORTER: "otlp" }, "OTEL_EXPORTER_OTLP_ENDPOINT"],
    [{ OTEL_METRICS_EXPORTER: "otlp" }, "OTEL_EXPORTER_OTLP_ENDPOINT"],
    [{ OTEL_EXPORTER_OTLP_HEADERS: "no-equals-sign" }, "OTEL_EXPORTER_OTLP_HEADERS"],
    [{ OTEL_EXPORTER_OTLP_HEADERS: "=value" }, "OTEL_EXPORTER_OTLP_HEADERS"],
    [{ OTEL_TRACES_SAMPLER_ARG: "1.5" }, "OTEL_TRACES_SAMPLER_ARG"],
    [{ OTEL_TRACES_SAMPLER_ARG: "abc" }, "OTEL_TRACES_SAMPLER_ARG"],
    [{ OTEL_TRACES_SAMPLER: "jaeger_remote" }, "OTEL_TRACES_SAMPLER"],
    [{ OTEL_EXPORTER_PROMETHEUS_PORT: "70000" }, "OTEL_EXPORTER_PROMETHEUS_PORT"],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: "not a url", OTEL_TRACES_EXPORTER: "otlp" }, "OTEL_EXPORTER_OTLP_ENDPOINT"],
    [{ OTEL_METRICS_EXPORTER: "prometheus", NODE_ENV: "production" }, "OTEL_METRICS_EXPORTER"],
  ])("%j → issue naming %s", (env, varName) => {
    const issues = issuesFor(env as Record<string, string>);
    expect(issues.some((i) => i.startsWith(`${varName}:`))).toBe(true);
  });

  it("never echoes a header value in an issue", () => {
    const issues = issuesFor({ OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic s3cret,broken" });
    expect(issues.join("\n")).not.toContain("s3cret");
  });
});

describe("AC2 — valid telemetry config", () => {
  it("resolves per-signal URLs from the base endpoint", () => {
    const c = ok({
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp-gateway-prod-us-east-0.grafana.net/otlp",
    });
    expect(c.enabled).toBe(true);
    expect(c.metrics.otlpUrl).toBe("https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/metrics");
    expect(c.traces.otlpUrl).toBe("https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces");
  });

  it("a per-signal traces endpoint is used verbatim", () => {
    const c = ok({ OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4318/v1/traces" });
    expect(c.traces.otlpUrl).toBe("http://localhost:4318/v1/traces");
  });

  it("splits headers on the first '=' and URL-decodes values (Grafana Cloud form)", () => {
    const c = ok({ OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic%20MTIzOnRvaw==, X-Other = a" });
    expect(c.otlpHeaders).toEqual({ Authorization: "Basic MTIzOnRvaw==", "X-Other": "a" });
  });

  it("maps samplers to a ratio", () => {
    expect(ok({ OTEL_TRACES_SAMPLER: "always_off" }).traces.samplerRatio).toBe(0);
    expect(ok({ OTEL_TRACES_SAMPLER: "always_on" }).traces.samplerRatio).toBe(1);
    expect(ok({ OTEL_TRACES_SAMPLER: "parentbased_traceidratio", OTEL_TRACES_SAMPLER_ARG: "0.25" }).traces.samplerRatio).toBe(0.25);
  });

  it("keeps the sampler kind so always_on / always_off are honored exactly", () => {
    expect(ok({}).traces.sampler).toBe("parentbased_traceidratio");
    expect(ok({ OTEL_TRACES_SAMPLER: "always_off" }).traces.sampler).toBe("always_off");
    expect(ok({ OTEL_TRACES_SAMPLER: "always_on" }).traces.sampler).toBe("always_on");
  });

  it("AC2 — a malformed OTEL_RESOURCE_ATTRIBUTES is refused, not ignored", () => {
    const { issues } = parseTelemetryEnv({ OTEL_RESOURCE_ATTRIBUTES: "deployment.environment staging" });
    expect(issues).toEqual(["OTEL_RESOURCE_ATTRIBUTES: must be a comma-separated key=value list"]);
  });

  it("reads service identity", () => {
    const c = ok({
      SERVICE_NAME: "si-api-x",
      RENDER_GIT_COMMIT: "abc123",
      OTEL_RESOURCE_ATTRIBUTES: "team=me,deployment.environment=staging",
    });
    expect(c.serviceName).toBe("si-api-x");
    expect(c.serviceVersion).toBe("abc123");
    expect(c.environment).toBe("staging");
    expect(ok({ SERVICE_VERSION: "v1", RENDER_GIT_COMMIT: "abc" }).serviceVersion).toBe("v1");
  });

  it("allows prometheus outside production", () => {
    expect(ok({ OTEL_METRICS_EXPORTER: "prometheus", NODE_ENV: "development" }).metrics.exporter).toBe("prometheus");
  });
});
