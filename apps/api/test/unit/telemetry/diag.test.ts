import { describe, it, expect, vi } from "vitest";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { createThrottledReporter, errorText } from "../../../src/telemetry/diag.js";
import { reportingSpanExporter } from "../../../src/telemetry/sdk.js";

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

describe("#126 — an SDK warning has its own slot and wording", () => {
  it("a warning that mentions metrics doesn't hide the next metrics export failure", () => {
    let t = 0;
    const sink = { warn: vi.fn() };
    const r = createThrottledReporter(sink, { now: () => t });
    r.diagLogger.warn('Instrument name is invalid for metric "x"');
    r.report("PeriodicExportingMetricReader: metrics export failed (error connect ECONNREFUSED)");
    expect(sink.warn).toHaveBeenCalledTimes(2);
    expect(sink.warn.mock.calls[0]).toEqual([
      { signal: "sdk", err: undefined },
      'telemetry SDK warning: Instrument name is invalid for metric "x"',
    ]);
    expect(sink.warn.mock.calls[1]![0]).toMatchObject({ signal: "metrics" });
    expect(sink.warn.mock.calls[1]![1]).toMatch(/^telemetry export problem: /);
    // SDK warnings are throttled among themselves.
    t += 1000;
    r.diagLogger.error("span attribute dropped");
    expect(sink.warn).toHaveBeenCalledTimes(2);
  });

  it("a diag message about an export still counts as that signal's export problem", () => {
    const sink = { warn: vi.fn() };
    const r = createThrottledReporter(sink, { now: () => 0 });
    r.diagLogger.error("PeriodicExportingMetricReader: metrics export timed out after 30000ms");
    r.report("metrics export failed again");
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.warn.mock.calls[0]![0]).toMatchObject({ signal: "metrics" });
  });

  it("an Error passed as the diag message is read as its text", () => {
    const sink = { warn: vi.fn() };
    const r = createThrottledReporter(sink, { now: () => 0 });
    const err = new Error("collection failed");
    (r.diagLogger.error as (m: unknown) => void)(err);
    expect(sink.warn).toHaveBeenCalledWith({ signal: "sdk", err }, "telemetry SDK warning: collection failed");
  });
});

describe("#121 — span export failures read clearly and are reported once", () => {
  const refused = (addr: string) => Object.assign(new Error(`connect ECONNREFUSED ${addr}`), { code: "ECONNREFUSED" });

  it("errorText names an AggregateError's inner errors, else the code, else the name", () => {
    expect(errorText(new AggregateError([refused("::1:4318"), refused("127.0.0.1:4318")]))).toBe(
      "connect ECONNREFUSED ::1:4318; connect ECONNREFUSED 127.0.0.1:4318",
    );
    expect(errorText(new AggregateError([refused("a"), refused("a")], "export failed"))).toBe(
      "export failed: connect ECONNREFUSED a",
    );
    expect(errorText(new AggregateError(["a", "b", "c", "d", "e"].map((x) => new Error(x))))).toBe("a; b; c (+2 more)");
    expect(errorText(Object.assign(new Error(""), { code: "ETIMEDOUT" }))).toBe("ETIMEDOUT");
    expect(errorText(new TypeError(""))).toBe("TypeError");
    expect(errorText("plain")).toBe("plain");
  });

  const failingExporter = (error: Error | undefined): SpanExporter => ({
    export: (_spans, done) => done({ code: ExportResultCode.FAILED, ...(error ? { error } : {}) }),
    shutdown: () => Promise.resolve(),
  });

  it("an AggregateError is reported with its inner errors, and the processor gets the same error", () => {
    const report = vi.fn();
    const reported = new WeakSet<object>();
    const err = new AggregateError([refused("::1:4318"), refused("127.0.0.1:4318")]);
    let passedOn: ExportResult | undefined;
    reportingSpanExporter(failingExporter(err), report, reported).export([], (r) => (passedOn = r));
    expect(report).toHaveBeenCalledWith(
      "span export failed: connect ECONNREFUSED ::1:4318; connect ECONNREFUSED 127.0.0.1:4318",
      err,
    );
    expect(passedOn?.error).toBe(err);
    expect(reported.has(err)).toBe(true);
  });

  it("a failure with no error passes on the reported one, so the global handler skips it", () => {
    const report = vi.fn();
    const reported = new WeakSet<object>();
    let passedOn: ExportResult | undefined;
    reportingSpanExporter(failingExporter(undefined), report, reported).export([], (r) => (passedOn = r));
    expect(report).toHaveBeenCalledTimes(1);
    expect(passedOn?.code).toBe(ExportResultCode.FAILED);
    expect(passedOn?.error).toBe(report.mock.calls[0]![1]);
    expect(reported.has(passedOn!.error!)).toBe(true);
  });
});
