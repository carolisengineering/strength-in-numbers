import { describe, expect, it } from "vitest";
import { secretsFrom } from "../src/node/env.ts";
import { redact } from "../src/node/redact.ts";

const s = secretsFrom(
  { LOADTEST_ACCOUNT_PASSWORD: "abc.def", GRAFANA_PROM_RW_TOKEN: "glc_token_123", LOADTEST_AUTH0_CONNECTION: "loadtest" },
  ["LOADTEST_ACCOUNT_PASSWORD", "GRAFANA_PROM_RW_TOKEN", "LOADTEST_AUTH0_CONNECTION"],
);

describe("AC22 — redact", () => {
  it("replaces a secret value", () => {
    expect(redact("token abc.def", s)).toBe("token [redacted]");
  });

  it("replaces every occurrence of every secret, and regex characters are literal", () => {
    expect(redact("abc.def abcxdef glc_token_123 abc.def", s)).toBe("[redacted] abcxdef [redacted] [redacted]");
  });

  it("leaves config values such as the connection name alone", () => {
    expect(redact("loadtest cleanup --target staging", s)).toBe("loadtest cleanup --target staging");
  });

  it("extra values (tokens) are redacted too", () => {
    expect(redact("Bearer eyJhbGciOi.payload.sig", s, ["eyJhbGciOi.payload.sig"])).toBe("Bearer [redacted]");
  });
});
