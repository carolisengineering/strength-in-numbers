import type { DiagLogger } from "@opentelemetry/api";

/** Spec 13.0 §6.6 — export failures surface as one `warn` per signal per 5 min. */
export interface WarnSink {
  warn(obj: unknown, msg?: string): void;
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;

export type TelemetrySignal = "metrics" | "traces" | "other";

const signalOf = (message: string): TelemetrySignal =>
  /metric/i.test(message) ? "metrics" : /span|trace/i.test(message) ? "traces" : "other";

/** A diag message about an export (a failure or a timeout); anything else is an SDK warning (#126). */
const isExportMessage = (message: string): boolean => /export/i.test(message);

const MAX_INNER_ERRORS = 3;

/**
 * #121 — readable text for an export error. An `AggregateError` (several
 * addresses refused, say) has an empty `message`, so its inner errors are named
 * instead; an error with no message falls back to its `code`, then its name.
 */
export function errorText(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    const inner = [...new Set(err.errors.map(errorText))];
    const shown = inner.slice(0, MAX_INNER_ERRORS).join("; ");
    const more = inner.length > MAX_INNER_ERRORS ? ` (+${inner.length - MAX_INNER_ERRORS} more)` : "";
    return err.message ? `${err.message}: ${shown}${more}` : `${shown}${more}`;
  }
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return err.message || (typeof code === "string" ? code : "") || err.name;
  }
  return String(err);
}

export function createThrottledReporter(
  sink: WarnSink,
  opts: { intervalMs?: number; now?: () => number } = {},
): { report(message: string, err?: unknown, signal?: TelemetrySignal): void; diagLogger: DiagLogger } {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const last = new Map<string, number>();

  const allowed = (key: string): boolean => {
    const t = now();
    const prev = last.get(key);
    if (prev !== undefined && t - prev < intervalMs) return false;
    last.set(key, t);
    return true;
  };

  // `signal` defaults to a guess from the text; a caller that knows the
  // signal passes it (an OTLP error like "connect ECONNREFUSED" names none).
  const report = (message: string, err?: unknown, signal: TelemetrySignal = signalOf(message)): void => {
    if (!allowed(signal)) return;
    sink.warn({ signal, err }, `telemetry export problem: ${message}`);
  };

  // #126 — an SDK warning that isn't about an export has its own slot and
  // wording, so it can't take a signal's slot and hide a real export failure.
  const sdkWarning = (message: string, err?: unknown): void => {
    if (!allowed("sdk")) return;
    sink.warn({ signal: "sdk", err }, `telemetry SDK warning: ${message}`);
  };

  // Some SDK code passes an Error as the message itself (`diag.error(err)`).
  const fromArgs = (message: unknown, ...args: unknown[]) => {
    const text = typeof message === "string" ? message : errorText(message);
    const err = message instanceof Error ? message : args.find((a) => a instanceof Error);
    if (isExportMessage(text)) report(text, err);
    else sdkWarning(text, err);
  };

  const diagLogger: DiagLogger = {
    error: fromArgs,
    warn: fromArgs,
    info: () => {},
    debug: () => {},
    verbose: () => {},
  };
  return { report, diagLogger };
}
