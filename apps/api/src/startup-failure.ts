import { ConfigError } from "./config.js";

const errorText = (err: unknown): string => (err instanceof Error ? (err.stack ?? err.message) : String(err));

/**
 * The one stderr line for a boot that fails (#119): server.ts and the telemetry bootstrap both print this, then
 * exit 1. A ConfigError is fail-fast config (Spec 01 criterion 2) and prints its message alone. Any other error
 * prints its stack and each `cause` below it, as Node's own uncaught-error printer did (a cycle stops). No Fastify
 * import: telemetry/register.ts loads this before server.ts.
 */
export function startupFailureMessage(err: unknown): string {
  if (err instanceof ConfigError) return `${err.message}\n`;
  let out = `Fatal startup error: ${errorText(err)}\n`;
  const seen = new Set<unknown>([err]);
  for (let cause = err instanceof Error ? err.cause : undefined; cause !== undefined && !seen.has(cause); ) {
    seen.add(cause);
    out += `Caused by: ${errorText(cause)}\n`;
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return out;
}
