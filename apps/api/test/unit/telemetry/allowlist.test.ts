import { describe, it, expect } from "vitest";
import { SpanStatusCode, SpanKind, ROOT_CONTEXT, type Attributes } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { AllowlistSpanProcessor } from "../../../src/telemetry/allowlist.js";

const FORBIDDEN: Attributes = {
  "client.address": "203.0.113.9",
  "network.peer.address": "203.0.113.9",
  "user_agent.original": "Mozilla/5.0",
  "url.full": "https://api/v1/workouts/0190?x=1",
  "url.path": "/v1/workouts/0190",
  "url.query": "x=1",
  "enduser.id": "auth0|abc",
  "http.request.header.authorization": "Bearer t",
  "http.response.header.set-cookie": "a=b",
  "http.target": "/v1/workouts/0190",
  "db.statement.params": "[80, 5]",
};
const ALLOWED: Attributes = {
  "http.request.method": "GET",
  "http.route": "/v1/workouts/:id",
  "http.response.status_code": 500,
  "error.type": "500",
  "db.system": "postgresql",
  "db.statement": 'SELECT "id" FROM "workout" WHERE "id" = $1',
  "sin.request_id": "req-1",
};

function harness() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new AllowlistSpanProcessor(new SimpleSpanProcessor(exporter))],
  });
  return { exporter, tracer: provider.getTracer("t") };
}

describe("AC7 — span attribute allowlist", () => {
  it("drops every non-allowlisted attribute and keeps the allowlisted ones", () => {
    const { exporter, tracer } = harness();
    tracer.startSpan("GET /v1/workouts/:id", { kind: SpanKind.SERVER, attributes: { ...FORBIDDEN, ...ALLOWED } }, ROOT_CONTEXT).end();
    const [span] = exporter.getFinishedSpans();
    expect(span!.attributes).toEqual(ALLOWED);
  });

  it("keeps exception events with only exception.type; drops other events", () => {
    const { exporter, tracer } = harness();
    const s = tracer.startSpan("x", {}, ROOT_CONTEXT);
    s.recordException(new TypeError("user typed: 80kg squat"));
    s.addEvent("custom", { "user.input": "secret" });
    s.end();
    const [span] = exporter.getFinishedSpans();
    expect(span!.events).toHaveLength(1);
    expect(span!.events[0]!.name).toBe("exception");
    expect(span!.events[0]!.attributes).toEqual({ "exception.type": "TypeError" });
  });

  it("clears status.message but keeps the status code (Review Focus 1)", () => {
    const { exporter, tracer } = harness();
    const s = tracer.startSpan("x", {}, ROOT_CONTEXT);
    s.setStatus({ code: SpanStatusCode.ERROR, message: "invalid weight 999kg" });
    s.end();
    const [span] = exporter.getFinishedSpans();
    expect(span!.status).toEqual({ code: SpanStatusCode.ERROR });
  });

  it("drops link attributes", () => {
    const { exporter, tracer } = harness();
    const parent = tracer.startSpan("p", {}, ROOT_CONTEXT);
    tracer.startSpan("x", { links: [{ context: parent.spanContext(), attributes: { "enduser.id": "u" } }] }, ROOT_CONTEXT).end();
    parent.end();
    const span = exporter.getFinishedSpans().find((s) => s.name === "x")!;
    expect(span.links[0]!.attributes).toEqual({});
  });
});
