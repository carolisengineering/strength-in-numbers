import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { buildViews, METRIC_NAMES } from "../../../src/telemetry/views.js";
import { parseThrottledUsec, registerRuntimePressureMetrics } from "../../../src/telemetry/runtime-pressure.js";
import { TestMetricReader, metricPoints } from "../../helpers/telemetry.js";

let reader: TestMetricReader;
let provider: MeterProvider;
const meter = () => provider.getMeter("sin-api");

beforeEach(() => {
  reader = new TestMetricReader();
  provider = new MeterProvider({ readers: [reader], views: buildViews() });
});
afterEach(async () => {
  await provider.shutdown();
});

const enoent = (): string => {
  throw Object.assign(new Error("ENOENT: no such file or directory, open '/sys/fs/cgroup/cpu.stat'"), { code: "ENOENT" });
};

describe("AC2 — process CPU counter", () => {
  it("exports user and system seconds from the CPU-usage source, with only cpu.mode", async () => {
    registerRuntimePressureMetrics(meter(), {
      report: vi.fn(),
      cpuUsage: () => ({ user: 1_500_000, system: 500_000 }),
      readCpuStat: enoent,
    });
    const points = await metricPoints(reader, METRIC_NAMES.processCpu);
    expect(points).toHaveLength(2);
    expect(points).toEqual(
      expect.arrayContaining([
        { attributes: { "cpu.mode": "user" }, value: 1.5 },
        { attributes: { "cpu.mode": "system" }, value: 0.5 },
      ]),
    );
  });

  it("with the real source, values never decrease and user grows after burning CPU", async () => {
    registerRuntimePressureMetrics(meter(), { report: vi.fn(), readCpuStat: enoent });
    const value = (points: { attributes: Record<string, unknown>; value: unknown }[], mode: string) =>
      points.find((p) => p.attributes["cpu.mode"] === mode)!.value as number;
    const first = await metricPoints(reader, METRIC_NAMES.processCpu);
    const start = process.cpuUsage().user;
    let x = 0;
    while (process.cpuUsage().user - start < 50_000) x += Math.sqrt(x + 1);
    expect(x).toBeGreaterThan(0);
    const second = await metricPoints(reader, METRIC_NAMES.processCpu);
    expect(value(second, "user")).toBeGreaterThan(value(first, "user"));
    expect(value(second, "system")).toBeGreaterThanOrEqual(value(first, "system"));
  });
});

describe("AC3 — throttling counter, only where the platform has it", () => {
  it("parses throttled_usec", () => {
    expect(parseThrottledUsec("usage_usec 9\nthrottled_usec 2500000\n")).toBe(2_500_000);
    expect(parseThrottledUsec("usage_usec 9\n")).toBeUndefined();
    expect(parseThrottledUsec("throttled_usec x")).toBeUndefined();
    expect(parseThrottledUsec("throttled_usec -4")).toBeUndefined();
  });

  it("registers and exports seconds when cpu.stat has throttled_usec", async () => {
    const result = registerRuntimePressureMetrics(meter(), {
      report: vi.fn(),
      cpuUsage: () => ({ user: 0, system: 0 }),
      readCpuStat: () => "usage_usec 9\nthrottled_usec 2500000\n",
    });
    expect(result).toEqual({ throttling: true });
    expect(await metricPoints(reader, METRIC_NAMES.cpuThrottled)).toEqual([{ attributes: {}, value: 2.5 }]);
  });

  it("does not register when the file is missing", async () => {
    const report = vi.fn();
    const result = registerRuntimePressureMetrics(meter(), { report, cpuUsage: () => ({ user: 0, system: 0 }), readCpuStat: enoent });
    expect(result).toEqual({ throttling: false });
    expect(await metricPoints(reader, METRIC_NAMES.cpuThrottled)).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("does not register when the line is malformed", async () => {
    const result = registerRuntimePressureMetrics(meter(), {
      report: vi.fn(),
      cpuUsage: () => ({ user: 0, system: 0 }),
      readCpuStat: () => "throttled_usec x",
    });
    expect(result).toEqual({ throttling: false });
    expect(await metricPoints(reader, METRIC_NAMES.cpuThrottled)).toEqual([]);
  });

  it("a read error on a later collection observes nothing that cycle and reports once", async () => {
    let calls = 0;
    const report = vi.fn();
    registerRuntimePressureMetrics(meter(), {
      report,
      cpuUsage: () => ({ user: 0, system: 0 }),
      readCpuStat: () => {
        calls += 1;
        if (calls > 1) throw new Error("EIO: i/o error");
        return "throttled_usec 1000000\n";
      },
    });
    expect(await metricPoints(reader, METRIC_NAMES.cpuThrottled)).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe("AC8 — failure isolation", () => {
  it("a throwing CPU source observes nothing, reports, and collect still resolves", async () => {
    const report = vi.fn();
    registerRuntimePressureMetrics(meter(), {
      report,
      cpuUsage: () => {
        throw new Error("cpuUsage broke");
      },
      readCpuStat: enoent,
    });
    expect(await metricPoints(reader, METRIC_NAMES.processCpu)).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0]![0])).toContain("cpuUsage broke");
  });
});
