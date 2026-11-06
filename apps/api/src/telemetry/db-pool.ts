import type { Meter } from "@opentelemetry/api";
import { exportErrorText } from "./diag.js";

/**
 * Spec 13.3 §6.3 — the database connection pool as metrics: connections in use and idle, queries waiting for a
 * connection, the configured limit, and cumulative wait time and count. The numbers come from Prisma's `metrics`
 * preview (`$metrics.json()`), passed in structurally so `telemetry/` never imports `@prisma/client` (AC17).
 */

/** What `db.ts` hands in: whether the engine has started, and Prisma's metrics JSON. */
export interface PoolMetricsSource {
  /** False until the client has run a query (or connected), and again after `$disconnect` — reading would start it (AC7). */
  engineStarted(): boolean;
  json(): Promise<unknown>;
}

/** Each field is present only when Prisma's JSON carried its key. */
export interface PoolNumbers {
  busy?: number;
  idle?: number;
  waiting?: number;
  waitSecondsTotal?: number;
  waitsTotal?: number;
}

const KEYS = {
  busy: "prisma_pool_connections_busy",
  idle: "prisma_pool_connections_idle",
  waiting: "prisma_client_queries_wait",
  waitHistogram: "prisma_client_queries_wait_histogram_ms",
} as const;

type Entry = { key?: unknown; value?: unknown };

const isEntryList = (v: unknown): v is Entry[] => Array.isArray(v);

/** Prisma's metrics JSON → pool numbers; `undefined` only when the top level isn't `{counters, gauges, histograms}` arrays. */
export function readPoolNumbers(json: unknown): PoolNumbers | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const { counters, gauges, histograms } = json as Record<string, unknown>;
  if (!isEntryList(counters) || !isEntryList(gauges) || !isEntryList(histograms)) return undefined;

  const gauge = (key: string): number | undefined => {
    const value = gauges.find((m) => m?.key === key)?.value;
    return typeof value === "number" ? value : undefined;
  };
  const numbers: PoolNumbers = {};
  const busy = gauge(KEYS.busy);
  const idle = gauge(KEYS.idle);
  const waiting = gauge(KEYS.waiting);
  if (busy !== undefined) numbers.busy = busy;
  if (idle !== undefined) numbers.idle = idle;
  if (waiting !== undefined) numbers.waiting = waiting;

  const histogram = histograms.find((m) => m?.key === KEYS.waitHistogram)?.value as { sum?: unknown; count?: unknown } | undefined;
  if (typeof histogram?.sum === "number" && typeof histogram.count === "number") {
    numbers.waitSecondsTotal = histogram.sum / 1000;
    numbers.waitsTotal = histogram.count;
  }
  return numbers;
}

/**
 * Registers the pool instruments. One batch callback reads the source once per collection; it returns without
 * reading while the engine is stopped (AC7), and on any failure observes nothing and reports (AC8).
 */
export function registerDbPoolMetrics(
  meter: Meter,
  source: PoolMetricsSource,
  limit: number | undefined,
  report: (message: string, err?: unknown) => void,
): void {
  const connections = meter.createObservableGauge("sin.db.pool.connections", {
    description: "Database connections in the pool, by state (busy / idle)",
  });
  const waiting = meter.createObservableGauge("sin.db.pool.waiting", {
    description: "Queries currently waiting for a free database connection",
  });
  const waitTime = meter.createObservableCounter("sin.db.pool.wait", {
    unit: "s",
    description: "Total time queries spent waiting for a free database connection",
  });
  const waits = meter.createObservableCounter("sin.db.pool.waits", {
    description: "Queries that went through the connection wait (count of the wait histogram)",
  });

  meter.addBatchObservableCallback(
    async (result) => {
      if (!source.engineStarted()) return;
      try {
        const numbers = readPoolNumbers(await source.json());
        if (numbers === undefined) {
          report("DB pool metrics: Prisma's metrics JSON had an unexpected shape");
          return;
        }
        if (numbers.busy !== undefined) result.observe(connections, numbers.busy, { state: "busy" });
        if (numbers.idle !== undefined) result.observe(connections, numbers.idle, { state: "idle" });
        if (numbers.waiting !== undefined) result.observe(waiting, numbers.waiting);
        if (numbers.waitSecondsTotal !== undefined) result.observe(waitTime, numbers.waitSecondsTotal);
        if (numbers.waitsTotal !== undefined) result.observe(waits, numbers.waitsTotal);
      } catch (err) {
        report(`DB pool metrics collection failed: ${exportErrorText(err)}`, err);
      }
    },
    [connections, waiting, waitTime, waits],
  );

  if (limit !== undefined && Number.isInteger(limit) && limit > 0) {
    meter
      .createObservableGauge("sin.db.pool.limit", { description: "The pool's configured connection limit" })
      .addCallback((result) => result.observe(limit));
  }
}
