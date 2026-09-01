/**
 * Graceful shutdown (Spec 01 §6.4, criterion 13).
 *
 * On SIGTERM/SIGINT: stop accepting, drain in-flight requests (`app.close()`)
 * with a bounded timeout, close the DB pool (`prisma.$disconnect()`), exit 0.
 * If the drain overruns the timeout, or a second signal arrives while draining,
 * force an immediate non-zero exit rather than waiting for the platform's
 * SIGKILL.
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

export interface GracefulShutdownDeps {
  app: ClosableApp;
  prisma: DisconnectablePool;
  logger?: ShutdownLogger;
  exit?: (code: number) => void;
  /** Max time to wait for in-flight requests to drain (default 10 s). */
  drainTimeoutMs?: number;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

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
        exit(1);
        return;
      }

      await deps.prisma.$disconnect();
      deps.logger?.info({ signal }, "graceful shutdown complete");
      exit(0);
    } catch (err) {
      deps.logger?.error({ err, signal }, "graceful shutdown failed");
      exit(1);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
