import { describe, expect, it } from "vitest";
import { secretsFrom } from "../src/node/env.ts";
import { Redactor, redact } from "../src/node/redact.ts";

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

// Final review (16B): the CLI runs everything it prints, its errors and the result file through one Redactor that
// learns each secret and token as the CLI loads them.
describe("AC22 — the CLI's Redactor", () => {
  it("redacts nothing until it learns a value, then every value it has learned", () => {
    const r = new Redactor();
    expect(r.apply("token abc.def and eyJ.tok.en")).toBe("token abc.def and eyJ.tok.en");
    r.learn(s);
    r.learnValues(["eyJ.tok.en", ""]);
    expect(r.apply("token abc.def and eyJ.tok.en; glc_token_123")).toBe("token [redacted] and [redacted]; [redacted]");
  });

  it("keeps a value that contains another whole", () => {
    const r = new Redactor();
    r.learnValues(["abc", "abc.def.ghi"]);
    expect(r.apply("x abc.def.ghi y abc")).toBe("x [redacted] y [redacted]");
  });
});

describe("minor 593 — a secret is redacted in its JSON-escaped form too", () => {
  it("a quote and a backslash inside a stringified result", () => {
    const r = new Redactor();
    r.learnValues(['ab"c\\d']);
    const out = r.apply(JSON.stringify({ x: 'ab"c\\d' }, null, 2));
    expect(out).not.toContain("ab");
    expect(out).toContain("[redacted]");
  });

  it("Review Focus 3: a newline inside a stringified result", () => {
    const r = new Redactor();
    r.learnValues(["line1\nline2"]);
    expect(r.apply(JSON.stringify({ x: "line1\nline2" }))).toBe('{"x":"[redacted]"}');
  });

  it("a plain value is redacted as before", () => {
    const r = new Redactor();
    r.learnValues(["plain"]);
    expect(r.apply("a plain b")).toBe("a [redacted] b");
  });
});
