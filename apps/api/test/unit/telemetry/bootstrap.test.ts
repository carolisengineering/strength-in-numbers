import { describe, it, expect, vi } from "vitest";
import { bootstrapTelemetry } from "../../../src/telemetry/register.js";
import { getTelemetryHandle, setTelemetryHandle } from "../../../src/telemetry/handle.js";
import { ConfigError } from "../../../src/config.js";
import { TEST_ENV } from "../../helpers/build-test-app.js";

describe("AC1 — off by default", () => {
  it("constructs nothing when no exporter is configured", () => {
    const start = vi.fn();
    expect(bootstrapTelemetry({ ...TEST_ENV }, start)).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
    expect(getTelemetryHandle()).toBeUndefined();
  });

  it("starts and publishes the handle when an exporter is configured", () => {
    const handle = { forceFlush: vi.fn(), shutdown: vi.fn() };
    const start = vi.fn(() => handle);
    const env = { ...TEST_ENV, OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4318/v1/traces" };
    expect(bootstrapTelemetry(env, start)).toBe(handle);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }), expect.anything());
    expect(getTelemetryHandle()).toBe(handle);
    setTelemetryHandle(undefined);
  });
});

describe("AC2 — bootstrap fails fast", () => {
  it("throws ConfigError before starting anything", () => {
    const start = vi.fn();
    expect(() => bootstrapTelemetry({ ...TEST_ENV, OTEL_TRACES_EXPORTER: "otlp" }, start)).toThrow(ConfigError);
    expect(start).not.toHaveBeenCalled();
  });
});
