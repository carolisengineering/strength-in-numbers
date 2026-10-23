import { ConfigError } from "./config.js";

/**
 * The one stderr line for a boot that fails (#119): server.ts and the telemetry bootstrap both print this, then
 * exit 1. A ConfigError is fail-fast config (Spec 01 criterion 2) and prints its message alone. No Fastify import:
 * telemetry/register.ts loads this before server.ts.
 */
export function startupFailureMessage(err: unknown): string {
  if (err instanceof ConfigError) return `${err.message}\n`;
  return `Fatal startup error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`;
}
