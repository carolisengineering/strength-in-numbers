import { describe, it, expect } from "vitest";
import { ROOT_CONTEXT, SpanKind, TraceFlags, trace } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { buildSampler } from "../../../src/telemetry/sdk.js";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

function decide(sampler: ReturnType<typeof buildSampler>, parentFlags?: TraceFlags): SamplingDecision {
  const ctx =
    parentFlags === undefined
      ? ROOT_CONTEXT
      : trace.setSpanContext(ROOT_CONTEXT, {
          traceId: TRACE_ID,
          spanId: "b7ad6b7169203331",
          traceFlags: parentFlags,
          isRemote: true,
        });
  return sampler.shouldSample(ctx, TRACE_ID, "GET /x", SpanKind.SERVER, {}, []).decision;
}

describe("AC2 / §8 — OTEL_TRACES_SAMPLER is honored exactly", () => {
  it("always_off samples nothing, even under a sampled remote parent", () => {
    const s = buildSampler({ sampler: "always_off", samplerRatio: 0 }, true);
    expect(decide(s)).toBe(SamplingDecision.NOT_RECORD);
    expect(decide(s, TraceFlags.SAMPLED)).toBe(SamplingDecision.NOT_RECORD);
  });

  it("always_on samples everything, even under an unsampled remote parent", () => {
    const s = buildSampler({ sampler: "always_on", samplerRatio: 1 }, true);
    expect(decide(s)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(decide(s, TraceFlags.NONE)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it("parentbased_traceidratio follows the parent and applies the ratio at the root", () => {
    const s = buildSampler({ sampler: "parentbased_traceidratio", samplerRatio: 0 }, true);
    expect(decide(s)).toBe(SamplingDecision.NOT_RECORD);
    expect(decide(s, TraceFlags.SAMPLED)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it("with traces off nothing is sampled, whatever the sampler", () => {
    const s = buildSampler({ sampler: "always_on", samplerRatio: 1 }, false);
    expect(decide(s, TraceFlags.SAMPLED)).toBe(SamplingDecision.NOT_RECORD);
  });
});
