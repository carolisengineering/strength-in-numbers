import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_ENV } from "../../helpers/build-test-app.js";

// The SDK fails to start with an error that is not a ConfigError (an exporter that cannot be built, say).
vi.mock("../../../src/telemetry/sdk.js", () => ({
  startTelemetry: () => {
    throw new Error("exporter exploded");
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Runs register.ts's boot side effect (the SIN_TELEMETRY_AUTOSTART block) with exit and stderr captured. */
async function autostart(env: Record<string, string>) {
  for (const [key, value] of Object.entries({ ...TEST_ENV, ...env, SIN_TELEMETRY_AUTOSTART: "1" })) vi.stubEnv(key, value);
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const written: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  await import("../../../src/telemetry/register.js");
  return { exit, stderr: written.join("") };
}

describe("#119 — the telemetry autostart reports any bootstrap failure the way server.ts does", () => {
  it("a non-ConfigError prints 'Fatal startup error:' and exits 1, instead of rethrowing", async () => {
    const { exit, stderr } = await autostart({
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4318/v1/traces",
    });
    expect(stderr).toMatch(/^Fatal startup error: Error: exporter exploded\n/);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a ConfigError (Spec 13.0 AC2) still prints its message alone and exits 1", async () => {
    const { exit, stderr } = await autostart({ OTEL_TRACES_EXPORTER: "otlp" });
    expect(stderr).not.toContain("Fatal startup error");
    expect(stderr).toMatch(/OTEL_EXPORTER_OTLP/);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
