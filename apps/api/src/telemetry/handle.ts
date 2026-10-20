import type { TelemetryHandle } from "./sdk.js";

/**
 * Process-global so register.ts (loaded first by main.ts) and server.ts share it
 * even if a loader ever gave them distinct module instances.
 */
const KEY = Symbol.for("sin.telemetry.handle");
type Holder = { [KEY]?: TelemetryHandle };

export function setTelemetryHandle(h: TelemetryHandle | undefined): void {
  (globalThis as Holder)[KEY] = h;
}
export function getTelemetryHandle(): TelemetryHandle | undefined {
  return (globalThis as Holder)[KEY];
}
