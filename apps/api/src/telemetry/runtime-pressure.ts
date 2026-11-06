import { readFileSync } from "node:fs";
import type { Meter } from "@opentelemetry/api";
import { exportErrorText } from "./diag.js";

/**
 * Spec 13.3 §6.2 — the API process's CPU use, and (where the platform reports it) the time the container was
 * held back by its CPU quota. Both are cumulative counters in seconds; a dashboard's `rate()` turns them into
 * "cores in use" and "fraction of time throttled". Only registered when telemetry is on (`startTelemetry`).
 */

const CGROUP_CPU_STAT = "/sys/fs/cgroup/cpu.stat";

export interface RuntimePressureDeps {
  /** The SDK's throttled reporter (signal `metrics`): one warn per 5 minutes, never a throw (AC8). */
  report: (message: string, err?: unknown) => void;
  /** Microseconds, like `process.cpuUsage()` (the default). */
  cpuUsage?: () => { user: number; system: number };
  /** The cgroup v2 `cpu.stat` text (default: a read of `/sys/fs/cgroup/cpu.stat`). */
  readCpuStat?: () => string;
}

/** The `throttled_usec <n>` line of a cgroup v2 `cpu.stat`, or `undefined` when missing or not a non-negative integer. */
export function parseThrottledUsec(cpuStat: string): number | undefined {
  const match = /^throttled_usec (\S+)$/m.exec(cpuStat);
  if (!match || !/^\d+$/.test(match[1]!)) return undefined;
  return Number(match[1]);
}

/**
 * Registers `sin.process.cpu.time` always, and `sin.container.cpu.throttled` only if the cgroup file is readable
 * and has the line at registration (AC3: otherwise not registered, and no log).
 */
export function registerRuntimePressureMetrics(meter: Meter, deps: RuntimePressureDeps): { throttling: boolean } {
  const cpuUsage = deps.cpuUsage ?? (() => process.cpuUsage());
  const readCpuStat = deps.readCpuStat ?? (() => readFileSync(CGROUP_CPU_STAT, "utf8"));

  meter
    .createObservableCounter("sin.process.cpu.time", { unit: "s", description: "API process CPU time, by mode" })
    .addCallback((result) => {
      try {
        const { user, system } = cpuUsage();
        result.observe(user / 1e6, { "cpu.mode": "user" });
        result.observe(system / 1e6, { "cpu.mode": "system" });
      } catch (err) {
        deps.report(`process CPU collection failed: ${exportErrorText(err)}`, err);
      }
    });

  let available: boolean;
  try {
    available = parseThrottledUsec(readCpuStat()) !== undefined;
  } catch {
    available = false;
  }
  if (!available) return { throttling: false };

  meter
    .createObservableCounter("sin.container.cpu.throttled", {
      unit: "s",
      description: "Time the container was throttled by its CPU quota (cgroup v2)",
    })
    .addCallback((result) => {
      try {
        const usec = parseThrottledUsec(readCpuStat());
        if (usec === undefined) throw new Error(`no throttled_usec line in ${CGROUP_CPU_STAT}`);
        result.observe(usec / 1e6);
      } catch (err) {
        deps.report(`container CPU throttling collection failed: ${exportErrorText(err)}`, err);
      }
    });
  return { throttling: true };
}
