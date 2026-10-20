import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { TEST_ENV } from "../../helpers/build-test-app.js";

/**
 * AC1 — with telemetry off, boot loads none of the SDK, exporter or
 * instrumentation code (it would cost every Render cold start for nothing).
 * The instrumentations and exporters are CommonJS, so loading one leaves it in
 * Node's module cache.
 */
const SDK_MODULE = /@opentelemetry[/+](sdk-|instrumentation|exporter-)|@fastify[/+]otel|@prisma[/+]instrumentation/;

describe("AC1 — telemetry off loads no SDK code", () => {
  it("importing register.ts and bootstrapping with nothing set loads no instrumentation or exporter", async () => {
    const { bootstrapTelemetry } = await import("../../../src/telemetry/register.js");
    expect(await bootstrapTelemetry({ ...TEST_ENV })).toBeUndefined();
    const loaded = Object.keys(createRequire(import.meta.url).cache).filter((k) => SDK_MODULE.test(k));
    expect(loaded).toEqual([]);
  });
});
