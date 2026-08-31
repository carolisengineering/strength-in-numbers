/**
 * Graceful shutdown (Spec 01 §6.4, criterion 13).
 *
 * On SIGTERM/SIGINT: stop accepting, drain in-flight requests (`app.close()`),
 * close the DB pool (`prisma.$disconnect()`), then exit 0. Idempotent — a second
 * signal while shutting down is ignored.
 */

export interface ClosableApp {
  close(): Promise<void>;
}

export interface DisconnectablePool {
  $disconnect(): Promise<void>;
}

export interface ShutdownLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface GracefulShutdownDeps {
  app: ClosableApp;
  prisma: DisconnectablePool;
  logger?: ShutdownLogger;
  exit?: (code: number) => void;
}

export function createGracefulShutdown(
  deps: GracefulShutdownDeps,
): (signal: NodeJS.Signals) => Promise<void> {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  let inProgress = false;

  return async (signal: NodeJS.Signals): Promise<void> => {
    if (inProgress) return;
    inProgress = true;

    try {
      await deps.app.close();
      await deps.prisma.$disconnect();
      deps.logger?.info({ signal }, "graceful shutdown complete");
      exit(0);
    } catch (err) {
      deps.logger?.error({ err, signal }, "graceful shutdown failed");
      exit(1);
    }
  };
}
