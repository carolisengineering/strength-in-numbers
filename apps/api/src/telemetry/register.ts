import { ConfigError, loadConfig } from "../config.js";
import { createLogger } from "../logging.js";
import { setTelemetryHandle } from "./handle.js";
import type { startTelemetry, TelemetryHandle } from "./sdk.js";

/**
 * Spec 13.0 §6.1 — loaded by main.ts BEFORE server.ts so instrumentation patches
 * `http` before Fastify loads. Uses the full loadConfig so a bad env fails here
 * exactly as it would in server.ts (AC2), and so the diag logger gets the same
 * level + redaction as the app logger.
 *
 * `sdk.js` (the SDK, exporters and instrumentations) is imported only when
 * telemetry is on, so a telemetry-off boot loads none of it (AC1).
 */
export async function bootstrapTelemetry(
  env: Record<string, unknown>,
  start?: typeof startTelemetry,
): Promise<TelemetryHandle | undefined> {
  const config = loadConfig(env);
  if (!config.telemetry.enabled) return undefined;
  const startFn = start ?? (await import("./sdk.js")).startTelemetry;
  const handle = startFn(config.telemetry, { logger: createLogger(config) });
  setTelemetryHandle(handle);
  return handle;
}

// Executed only as the boot side effect (main.ts); tests call bootstrapTelemetry directly.
if (process.env.SIN_TELEMETRY_AUTOSTART === "1") {
  try {
    await bootstrapTelemetry(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
