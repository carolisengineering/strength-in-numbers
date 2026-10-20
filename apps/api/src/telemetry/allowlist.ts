import type { Context, Attributes } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * Spec 13.0 §7 — the only span attributes that leave the process. Allowlist,
 * not denylist (D5): an attribute an instrumentation upgrade adds is dropped
 * until someone lists it here (with a test).
 */
export const SPAN_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set([
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "error.type",
  "url.scheme",
  "server.address",
  "server.port",
  "db.system",
  // Prisma emits parameterized SQL with no bound values (prisma/orm#26731 is an
  // opt-in for values that we never enable). Both names: semconv is renaming it.
  "db.statement",
  "db.query.text",
  // Prisma's `prisma:client:operation` span: the model and client method names
  // (e.g. "User", "findUnique") — schema names, never data.
  "model",
  "method",
  "sin.request_id",
]);

const EXCEPTION_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set(["exception.type"]);

function pick(attrs: Attributes | undefined, allow: ReadonlySet<string>): Attributes {
  const out: Attributes = {};
  if (!attrs) return out;
  for (const [k, v] of Object.entries(attrs)) if (allow.has(k)) out[k] = v;
  return out;
}

export function redactSpan(
  span: ReadableSpan,
  allow: ReadonlySet<string> = SPAN_ATTRIBUTE_ALLOWLIST,
): ReadableSpan {
  return {
    name: span.name,
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    // instrumentation-http copies error.message into status.message (Review Focus 1).
    status: { code: span.status.code },
    attributes: pick(span.attributes, allow),
    links: span.links.map((l) => ({ ...l, attributes: {} })),
    events: span.events
      .filter((e) => e.name === "exception")
      .map((e) => ({ ...e, attributes: pick(e.attributes, EXCEPTION_ATTRIBUTE_ALLOWLIST) })),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

/** Wraps the exporting processor; every span is redacted on `onEnd` before the delegate sees it. */
export class AllowlistSpanProcessor implements SpanProcessor {
  constructor(
    private readonly delegate: SpanProcessor,
    private readonly allow: ReadonlySet<string> = SPAN_ATTRIBUTE_ALLOWLIST,
  ) {}
  onStart(span: Span, parentContext: Context): void {
    this.delegate.onStart(span, parentContext);
  }
  onEnd(span: ReadableSpan): void {
    this.delegate.onEnd(redactSpan(span, this.allow));
  }
  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }
  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}
