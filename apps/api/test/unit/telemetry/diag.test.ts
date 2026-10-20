import { describe, it, expect, vi } from "vitest";
import { createThrottledReporter } from "../../../src/telemetry/diag.js";

describe("AC11 — export failures are logged at warn, throttled per signal", () => {
  it("logs once per signal per 5 minutes", () => {
    let t = 0;
    const sink = { warn: vi.fn() };
    const r = createThrottledReporter(sink, { now: () => t });
    r.report("OTLPMetricExporter: export failed");
    r.report("OTLPMetricExporter: export failed");
    r.report("BatchSpanProcessor: span export failed");
    expect(sink.warn).toHaveBeenCalledTimes(2); // one metrics, one traces
    t += 5 * 60_000 - 1;
    r.report("metric export failed again");
    expect(sink.warn).toHaveBeenCalledTimes(2);
    t += 1;
    r.report("metric export failed again");
    expect(sink.warn).toHaveBeenCalledTimes(3);
  });

  it("the DiagLogger routes error and warn through the throttle and ignores info/debug", () => {
    const sink = { warn: vi.fn() };
    const { diagLogger } = createThrottledReporter(sink, { now: () => 0 });
    diagLogger.info("starting");
    diagLogger.debug("x");
    diagLogger.error("trace export failed", new Error("ECONNREFUSED"));
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.warn.mock.calls[0]![0]).toMatchObject({ signal: "traces" });
  });

  it("an explicit signal wins over the message text", () => {
    const sink = { warn: vi.fn() };
    const r = createThrottledReporter(sink, { now: () => 0 });
    r.report("connect ECONNREFUSED 127.0.0.1:4318", new Error("x"), "traces");
    r.report("connect ECONNREFUSED 127.0.0.1:4318", new Error("x"), "traces");
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.warn.mock.calls[0]![0]).toMatchObject({ signal: "traces" });
  });
});
