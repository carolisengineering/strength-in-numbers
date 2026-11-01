import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { Writable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  startTestTelemetry,
  stopTestTelemetry,
  metricPoints,
  type TelemetryHarness,
} from "../../helpers/telemetry.js";
import { METRIC_NAMES } from "../../../src/telemetry/views.js";
import { SPAN_ATTRIBUTE_ALLOWLIST } from "../../../src/telemetry/allowlist.js";

// Global Constraints: SDK first, THEN load anything that imports Fastify.
let h: TelemetryHarness;
let app: FastifyInstance;
let base: string;
const logLines: Record<string, unknown>[] = [];
const BEARER = { authorization: "Bearer test-token" };
const WORKOUT_ID = "01900000-0000-7000-8000-000000000001";

beforeAll(async () => {
  h = startTestTelemetry();
  const { buildTestApp, testConfig } = await import("../../helpers/build-test-app.js");
  const { createLogger } = await import("../../../src/logging.js");
  const sink = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split("\n").filter(Boolean)) logLines.push(JSON.parse(line));
      cb();
    },
  });
  ({ app } = await buildTestApp({ logger: createLogger(testConfig(), sink) }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  await app?.close();
  await stopTestTelemetry(h);
});
beforeEach(() => {
  h.spans.reset();
  logLines.length = 0;
});

const durationPoints = () => metricPoints(h.reader, METRIC_NAMES.httpDuration);

describe("AC3 — route-templated HTTP metrics", () => {
  it("records the route template, never the raw id", async () => {
    const res = await fetch(`${base}/v1/workouts/${WORKOUT_ID}`, { headers: BEARER });
    expect(res.status).toBe(404); // fake repo has no such workout — still a routed request
    const points = await durationPoints();
    const mine = points.filter((p) => p.attributes["http.route"] === "/v1/workouts/:id");
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]!.attributes).sort()).toEqual(
      ["http.request.method", "http.response.status_code", "http.route"].sort(),
    );
    expect(mine[0]!.attributes["http.response.status_code"]).toBe(404);
    expect(JSON.stringify(points)).not.toContain(WORKOUT_ID);
  });
});

describe("AC4 — health paths are not measured or traced", () => {
  it("/healthz and /readyz produce no observation and no span", async () => {
    const before = JSON.stringify(await durationPoints());
    await fetch(`${base}/healthz`);
    await fetch(`${base}/readyz`);
    expect(JSON.stringify(await durationPoints())).toBe(before);
    expect(h.spans.getFinishedSpans()).toHaveLength(0);
  });

  it("#122 — a query string does not take a health path out of the ignore list", async () => {
    const { IGNORE_HOOKS, isIgnoredUrl } = await import("../../../src/telemetry/sdk.js");
    expect(["/healthz?probe=1", "/readyz?x", "/metrics?", "/healthz"].map(isIgnoredUrl)).toEqual([true, true, true, true]);
    expect(["/v1/me?healthz", "/healthzx", undefined].map(isIgnoredUrl)).toEqual([false, false, false]);
    // Each hook on its own: the HTTP hook already stripped the query, so the end-to-end check below cannot see the Fastify one.
    expect(IGNORE_HOOKS.fastify({ url: "/healthz?probe=1" })).toBe(true);
    expect(IGNORE_HOOKS.http({ url: "/healthz?probe=1" })).toBe(true);
    expect(IGNORE_HOOKS.fastify({ url: "/v1/me?healthz" })).toBe(false);
    const before = JSON.stringify(await durationPoints());
    await fetch(`${base}/healthz?probe=1`);
    expect(JSON.stringify(await durationPoints())).toBe(before);
    expect(h.spans.getFinishedSpans()).toHaveLength(0);
  });
});

describe("AC5 — runtime metrics", () => {
  it("exports event-loop p99, heap used, and the process start time", async () => {
    await new Promise((r) => setTimeout(r, 50)); // let the event-loop histogram sample
    expect((await metricPoints(h.reader, METRIC_NAMES.eventLoopP99)).length).toBeGreaterThan(0);
    expect((await metricPoints(h.reader, METRIC_NAMES.heapUsed)).length).toBeGreaterThan(0);
    expect((await metricPoints(h.reader, METRIC_NAMES.processStart)).length).toBe(1);
  });
});

describe("AC6 (unit half) / AC7 — request spans carry only allowlisted attributes", () => {
  it("server span is named by route; every attribute is allowlisted; request id stamped", async () => {
    await fetch(`${base}/v1/workouts/${WORKOUT_ID}?x=1`, {
      headers: { ...BEARER, "x-request-id": "req-telemetry-1", "user-agent": "secret-agent" },
    });
    const spans = h.spans.getFinishedSpans();
    const server = spans.find((s) => s.name === "GET /v1/workouts/:id");
    expect(server, spans.map((s) => s.name).join(", ")).toBeDefined();
    for (const s of spans) {
      for (const key of Object.keys(s.attributes)) expect(SPAN_ATTRIBUTE_ALLOWLIST.has(key), key).toBe(true);
    }
    expect(spans.some((s) => s.attributes["sin.request_id"] === "req-telemetry-1")).toBe(true);
    // `server.address` is allowlisted (§7) and is the API's own host — loopback
    // here only because client and server share it; the client's IP must not
    // appear anywhere else.
    const withoutServerAddress = (a: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(a).filter(([k]) => k !== "server.address"));
    const dump = JSON.stringify(spans.map((s) => ({ a: withoutServerAddress(s.attributes), n: s.name, e: s.events })));
    for (const leak of ["127.0.0.1", "secret-agent", WORKOUT_ID, "x=1", "test-token"]) expect(dump).not.toContain(leak);
  });
});

describe("#128 — the request id is stamped by @fastify/otel's requestHook", () => {
  it("lands on the request span", async () => {
    await fetch(`${base}/v1/workouts/${WORKOUT_ID}`, { headers: { ...BEARER, "x-request-id": "req-telemetry-128" } });
    const request = h.spans.getFinishedSpans().find((s) => s.name === "request");
    expect(request?.attributes["sin.request_id"]).toBe("req-telemetry-128");
  });

  it("a telemetry-off app has no hook for it (buildApp never names the attribute or the OTel API)", () => {
    const appSource = readFileSync(fileURLToPath(new URL("../../../src/app.ts", import.meta.url)), "utf8");
    expect(appSource).not.toMatch(/@opentelemetry|setAttribute\(/);
  });
});

describe("#123 — no span is named with a plugin's source text", () => {
  it("hook spans name the plugin or hook function", async () => {
    await fetch(`${base}/v1/workouts/${WORKOUT_ID}`, { headers: BEARER });
    await fetch(`${base}/v1/hevy/status`, { headers: BEARER }); // the Hevy scope's gate answers 404
    const names = h.spans.getFinishedSpans().map((s) => s.name);
    expect(names).toContain("onRequest - v1Scope -> auth");
    expect(names).toContain("onRequest - hevyGate");
    for (const name of names) expect(name, name).toMatch(/^[\w /:.>-]+$/);
  });
});

describe("AC9 — log ↔ trace correlation", () => {
  it("request log lines carry the server span's trace_id and a span_id", async () => {
    await fetch(`${base}/v1/workouts/${WORKOUT_ID}`, { headers: BEARER });
    const server = h.spans.getFinishedSpans().find((s) => s.name === "GET /v1/workouts/:id")!;
    const traceId = server.spanContext().traceId;
    const correlated = logLines.filter((l) => l.trace_id === traceId);
    expect(correlated.length).toBeGreaterThan(0);
    expect(correlated.every((l) => typeof l.span_id === "string")).toBe(true);
  });
});
