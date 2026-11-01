import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type AddressInfo, type Server } from "node:net";
import type { FastifyInstance } from "fastify";
import { context, diag, metrics, propagation, trace } from "@opentelemetry/api";
import { parseTelemetryEnv } from "../../../src/telemetry/config.js";
import { startPrometheus, startTelemetry, type TelemetryHandle } from "../../../src/telemetry/sdk.js";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

let handle: TelemetryHandle;
let app: FastifyInstance;
let apiBase: string;
let promPort: number;

beforeAll(async () => {
  promPort = await freePort();
  const { config } = parseTelemetryEnv({ OTEL_METRICS_EXPORTER: "prometheus", OTEL_EXPORTER_PROMETHEUS_PORT: String(promPort) });
  handle = startTelemetry(config, { logger: { warn: () => {} } })!;
  const { buildTestApp } = await import("../../helpers/build-test-app.js");
  ({ app } = await buildTestApp());
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  apiBase = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  await new Promise((r) => setTimeout(r, 100)); // exporter server bind
});
afterAll(async () => {
  await app?.close();
  await handle?.shutdown();
  trace.disable(); metrics.disable(); context.disable(); propagation.disable(); diag.disable();
});

describe("AC13 — Prometheus endpoint is local-only and off the API port", () => {
  it("serves the route-templated histogram on its own port", async () => {
    await fetch(`${apiBase}/v1/me`, { headers: { authorization: "Bearer test-token" } });
    const text = await (await fetch(`http://127.0.0.1:${promPort}/metrics`)).text();
    expect(text).toMatch(/http_server_request_duration_seconds_bucket\{[^}]*http_route="\/v1\/me"/);
  });

  it("scraping /metrics is not itself measured (Review Focus 3)", async () => {
    await fetch(`http://127.0.0.1:${promPort}/metrics`);
    const text = await (await fetch(`http://127.0.0.1:${promPort}/metrics`)).text();
    expect(text).not.toMatch(/http_route="\/metrics"/);
    expect(text).not.toMatch(/http_server_request_duration_seconds_count\{(?![^}]*http_route)[^}]*\}/);
  });

  it("#120 — the endpoint listens on loopback, not every interface", async () => {
    const port = await freePort();
    const { config } = parseTelemetryEnv({ OTEL_METRICS_EXPORTER: "prometheus", OTEL_EXPORTER_PROMETHEUS_PORT: String(port) });
    const report = vi.fn();
    const exporter = startPrometheus(config.metrics, report);
    try {
      await exporter.startServer(); // the same start startPrometheus began
      const server = (exporter as unknown as { _server: Server })._server;
      expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
      expect(report).not.toHaveBeenCalled();
    } finally {
      await exporter.shutdown();
    }
  });

  it("#120 — a taken port is one metrics warning that names the address", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const port = (blocker.address() as AddressInfo).port;
    try {
      const { config } = parseTelemetryEnv({ OTEL_METRICS_EXPORTER: "prometheus", OTEL_EXPORTER_PROMETHEUS_PORT: String(port) });
      const report = vi.fn();
      startPrometheus(config.metrics, report);
      await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
      expect(report.mock.calls[0]![0]).toBe(
        `Prometheus /metrics could not listen on 127.0.0.1:${port} (listen EADDRINUSE: address already in use 127.0.0.1:${port}); no metrics are served`,
      );
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it("GET /metrics on the API port is the normal problem+json 404", async () => {
    const res = await fetch(`${apiBase}/metrics`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
