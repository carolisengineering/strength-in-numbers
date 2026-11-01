import { describe, it, expect, vi } from "vitest";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { createThrottledReporter, exportErrorText } from "../../../src/telemetry/diag.js";
import {
  AggregationTemporality,
  InstrumentType,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { reportingMetricExporter, reportingSpanExporter } from "../../../src/telemetry/sdk.js";

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

  it.each([
    ["export request failure (error: Error: connect ECONNREFUSED)", "export"],
    ["export response retryable (status: 503)", "export"],
    ["Received Partial Success response:", "export"],
    ["span export failed: Timeout", "export"],
    ["Configuration: Could not parse environment-provided export URL: 'x', falling back to undefined", "sdk"],
    ["Export succeeded but could not deserialize response - is the response specification compliant?", "sdk"],
    ['Header "x" has invalid value (y) and will be ignored', "sdk"],
  ])("%j is an %s line", (message, kind) => {
    const sink = { warn: vi.fn() };
    createThrottledReporter(sink, { now: () => 0 }).diagLogger.warn(message);
    expect(sink.warn.mock.calls[0]![1]).toBe(
      kind === "sdk" ? `telemetry SDK warning: ${message}` : `telemetry export problem: ${message}`,
    );
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

  it("exportErrorText names an AggregateError's inner errors, else the code, else the name", () => {
    expect(exportErrorText(new AggregateError([refused("::1:4318"), refused("127.0.0.1:4318")]))).toBe(
      "connect ECONNREFUSED ::1:4318; connect ECONNREFUSED 127.0.0.1:4318",
    );
    expect(exportErrorText(new AggregateError([refused("a"), refused("a")], "export failed"))).toBe(
      "export failed: connect ECONNREFUSED a",
    );
    expect(exportErrorText(new AggregateError(["a", "b", "c", "d", "e"].map((x) => new Error(x))))).toBe("a; b; c (+2 more)");
    expect(exportErrorText(Object.assign(new Error(""), { code: "ETIMEDOUT" }))).toBe("ETIMEDOUT");
    expect(exportErrorText(new TypeError(""))).toBe("TypeError");
    expect(exportErrorText("plain")).toBe("plain");
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

  it("a failed metrics export is reported with its inner errors, before the reader flattens them", () => {
    const err = new AggregateError([refused("::1:4318"), refused("127.0.0.1:4318")]);
    const temporality = vi.fn(() => AggregationTemporality.DELTA);
    const inner: PushMetricExporter = {
      export: (_metrics, done) => done({ code: ExportResultCode.FAILED, error: err }),
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
      selectAggregationTemporality: temporality,
    };
    const report = vi.fn();
    const wrapped = reportingMetricExporter(inner, report);
    let passedOn: ExportResult | undefined;
    wrapped.export({} as never, (r) => (passedOn = r));
    expect(report).toHaveBeenCalledWith(
      "metrics export failed: connect ECONNREFUSED ::1:4318; connect ECONNREFUSED 127.0.0.1:4318",
      err,
    );
    expect(passedOn?.error).toBe(err);
    // The aggregation choices still reach the reader; an absent one stays absent.
    expect(wrapped.selectAggregationTemporality?.(InstrumentType.COUNTER)).toBe(AggregationTemporality.DELTA);
    expect(wrapped.selectAggregation).toBeUndefined();
  });

  it("the reader's own flattened report of that failure lands in the same slot and is dropped", () => {
    const sink = { warn: vi.fn() };
    const r = createThrottledReporter(sink, { now: () => 0 });
    r.report("metrics export failed: connect ECONNREFUSED ::1:4318", undefined, "metrics");
    r.report("PeriodicExportingMetricReader: metrics export failed (error AggregateError)");
    expect(sink.warn).toHaveBeenCalledTimes(1);
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
