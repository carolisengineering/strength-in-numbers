import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config.js";
import { startupFailureMessage } from "../../src/startup-failure.js";

describe("#119 — one startup-failure message for server.ts and the telemetry bootstrap", () => {
  it("a ConfigError prints its message alone (Spec 01 criterion 2)", () => {
    const err = new ConfigError(["PORT: is required"]);
    expect(startupFailureMessage(err)).toBe(`${err.message}\n`);
  });

  it("any other Error prints 'Fatal startup error:' with its stack", () => {
    const err = new Error("exporter exploded");
    expect(startupFailureMessage(err)).toBe(`Fatal startup error: ${err.stack}\n`);
  });

  it("a wrapped error keeps its causes, as Node's own printer showed them", () => {
    const root = new Error("connect ECONNREFUSED");
    const mid = new Error("exporter setup failed", { cause: root });
    const err = new Error("telemetry failed", { cause: mid });
    expect(startupFailureMessage(err)).toBe(
      `Fatal startup error: ${err.stack}\nCaused by: ${mid.stack}\nCaused by: ${root.stack}\n`,
    );
  });

  it("a non-Error cause is stringified, and a cause cycle stops", () => {
    const err = new Error("outer", { cause: "socket hang up" });
    expect(startupFailureMessage(err)).toBe(`Fatal startup error: ${err.stack}\nCaused by: socket hang up\n`);
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(startupFailureMessage(b)).toBe(`Fatal startup error: ${b.stack}\nCaused by: ${a.stack}\n`);
  });

  it("a non-Error value is stringified", () => {
    expect(startupFailureMessage("nope")).toBe("Fatal startup error: nope\n");
  });
});
