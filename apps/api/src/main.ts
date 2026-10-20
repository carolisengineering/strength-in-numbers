/**
 * Spec 13.0 §6.1 (D15) — process entry point. Telemetry must start before
 * anything imports Fastify / node:http, so both steps are dynamic imports,
 * awaited in order (static imports would be hoisted and evaluated together).
 */
process.env.SIN_TELEMETRY_AUTOSTART = "1";
await import("./telemetry/register.js");
await import("./server.js");
