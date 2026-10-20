import type { DiagLogger } from "@opentelemetry/api";

/** Spec 13.0 §6.6 — export failures surface as one `warn` per signal per 5 min. */
export interface WarnSink {
  warn(obj: unknown, msg?: string): void;
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;

const signalOf = (message: string): "metrics" | "traces" | "other" =>
  /metric/i.test(message) ? "metrics" : /span|trace/i.test(message) ? "traces" : "other";

export function createThrottledReporter(
  sink: WarnSink,
  opts: { intervalMs?: number; now?: () => number } = {},
): { report(message: string, err?: unknown): void; diagLogger: DiagLogger } {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const last = new Map<string, number>();

  const report = (message: string, err?: unknown): void => {
    const signal = signalOf(message);
    const t = now();
    const prev = last.get(signal);
    if (prev !== undefined && t - prev < intervalMs) return;
    last.set(signal, t);
    sink.warn({ signal, err }, `telemetry export problem: ${message}`);
  };

  const fromArgs = (message: string, ...args: unknown[]) =>
    report(message, args.find((a) => a instanceof Error));

  const diagLogger: DiagLogger = {
    error: fromArgs,
    warn: fromArgs,
    info: () => {},
    debug: () => {},
    verbose: () => {},
  };
  return { report, diagLogger };
}
