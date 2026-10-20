/**
 * Graceful shutdown (Spec 01 §6.4, criterion 13).
 *
 * On SIGTERM/SIGINT: stop accepting, drain in-flight requests (`app.close()`)
 * with a bounded timeout, close the DB pool (`prisma.$disconnect()`), flush
 * telemetry (bounded, Spec 13.0 AC12), exit 0.
 * If the drain overruns the timeout or fails, flush telemetry (still bounded)
 * and exit non-zero; a second signal while draining forces an immediate
 * non-zero exit. Either way we exit before the platform's SIGKILL.
 */

export interface ClosableApp {
  close(): Promise<void>;
}

export interface DisconnectablePool {
  $disconnect(): Promise<void>;
}

export interface ShutdownLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface TelemetryFlusher {
  shutdown(): Promise<void>;
}

export interface GracefulShutdownDeps {
  app: ClosableApp;
  prisma: DisconnectablePool;
  telemetry?: TelemetryFlusher;
  logger?: ShutdownLogger;
  exit?: (code: number) => void;
  /** Max time to wait for in-flight requests to drain (default 10 s). */
  drainTimeoutMs?: number;
  /** Max time to wait for the telemetry flush (default 5 s); a hang never blocks exit. */
  telemetryTimeoutMs?: number;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;
const DEFAULT_TELEMETRY_TIMEOUT_MS = 5_000;

async function flushTelemetry(
  telemetry: TelemetryFlusher,
  timeoutMs: number,
  logger: ShutdownLogger | undefined,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    timer.unref?.();
  });
  try {
    const outcome = await Promise.race([
      telemetry.shutdown().then(() => "flushed" as const),
      deadline,
    ]);
    if (outcome === "timeout") {
      logger?.warn({ telemetryTimeoutMs: timeoutMs }, "telemetry flush timed out — exiting anyway");
    }
  } catch (err) {
    logger?.warn({ err }, "telemetry flush failed — exiting anyway");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createGracefulShutdown(
  deps: GracefulShutdownDeps,
): (signal: NodeJS.Signals) => Promise<void> {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const drainTimeoutMs = deps.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  let draining = false;

  return async (signal: NodeJS.Signals): Promise<void> => {
    if (draining) {
      deps.logger?.warn({ signal }, "second shutdown signal — forcing exit");
      exit(1);
      return;
    }
    draining = true;

    const flush = async (): Promise<void> => {
      if (!deps.telemetry) return;
      await flushTelemetry(
        deps.telemetry,
        deps.telemetryTimeoutMs ?? DEFAULT_TELEMETRY_TIMEOUT_MS,
        deps.logger,
      );
    };

    let timer: NodeJS.Timeout | undefined;
    const drainDeadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), drainTimeoutMs);
      timer.unref?.();
    });

    try {
      const outcome = await Promise.race([
        deps.app.close().then(() => "drained" as const),
        drainDeadline,
      ]);

      if (outcome === "timeout") {
        deps.logger?.error(
          { signal, drainTimeoutMs },
          "drain timed out — forcing exit",
        );
        // The spans of the requests that hung are the ones most worth keeping.
        await flush();
        exit(1);
        return;
      }

      await deps.prisma.$disconnect();
      await flush();
      deps.logger?.info({ signal }, "graceful shutdown complete");
      exit(0);
    } catch (err) {
      deps.logger?.error({ err, signal }, "graceful shutdown failed");
      await flush();
      exit(1);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
