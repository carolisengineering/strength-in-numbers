import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  ANNOTATION_SECRETS,
  METRICS_SECRETS,
  RUN_SECRETS,
  SECRET_NAMES,
  SETUP_SECRETS,
  loadSecrets,
  parseEnvFile,
  secretsFrom,
} from "../src/node/env.ts";

const TOOL_DIR = fileURLToPath(new URL("..", import.meta.url));

function envFile(text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "loadtest-env-")), ".env.loadtest");
  writeFileSync(path, text);
  return path;
}

const FULL = Object.fromEntries(SECRET_NAMES.map((n) => [n, `value-of-${n.toLowerCase()}`])) as Record<string, string>;

describe("AC22 — the env file", () => {
  it("is ignored by git, and .env.example is not", () => {
    expect(() => execFileSync("git", ["check-ignore", "-q", ".env.loadtest"], { cwd: TOOL_DIR })).not.toThrow();
    expect(() => execFileSync("git", ["check-ignore", "-q", ".env.example"], { cwd: TOOL_DIR })).toThrow();
  });

  it(".env.example lists every variable name with an empty value", () => {
    const example = parseEnvFile(readFileSync(join(TOOL_DIR, ".env.example"), "utf8"));
    expect(Object.keys(example).sort()).toEqual([...SECRET_NAMES].sort());
    for (const value of Object.values(example)) expect(value).toBe("");
  });

  it("each run kind needs the variables the plan names", () => {
    expect(RUN_SECRETS).toEqual([
      "AUTH0_DOMAIN",
      "AUTH0_AUDIENCE",
      "LOADTEST_AUTH0_CLIENT_ID",
      "LOADTEST_AUTH0_CLIENT_SECRET",
      "LOADTEST_AUTH0_CONNECTION",
      "LOADTEST_ACCOUNT_PASSWORD",
    ]);
    expect(SETUP_SECRETS).toEqual(["AUTH0_DOMAIN", "LOADTEST_AUTH0_CONNECTION", "LOADTEST_ACCOUNT_PASSWORD", "AUTH0_MGMT_CLIENT_ID", "AUTH0_MGMT_CLIENT_SECRET"]);
    expect(METRICS_SECRETS).toEqual(["GRAFANA_PROM_RW_URL", "GRAFANA_PROM_RW_USER", "GRAFANA_PROM_RW_TOKEN"]);
    expect(ANNOTATION_SECRETS).toEqual(["GRAFANA_URL", "GRAFANA_ANNOTATION_TOKEN"]);
  });
});

describe("parseEnvFile", () => {
  it("reads KEY=value lines, skipping blanks and comments, and strips matching quotes", () => {
    const text = "# a comment\n\nA=1\n  B = two words \nexport C=3\nD=\"quoted # not a comment\"\nE='single'\nF=a=b\n";
    expect(parseEnvFile(text)).toEqual({ A: "1", B: "two words", C: "3", D: "quoted # not a comment", E: "single", F: "a=b" });
  });

  it("handles Windows line endings", () => {
    expect(parseEnvFile("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });
});

describe("AC22 — loadSecrets", () => {
  it("returns the needed values", () => {
    const s = loadSecrets(envFile("AUTH0_DOMAIN=t.example.test\nGRAFANA_URL=https://g.example.test\n"), ["AUTH0_DOMAIN"]);
    expect(s.get("AUTH0_DOMAIN")).toBe("t.example.test");
  });

  it("names a missing variable, never a value", () => {
    const path = envFile("AUTH0_DOMAIN=t.example.test\n");
    expect(() => loadSecrets(path, ["AUTH0_DOMAIN", "LOADTEST_ACCOUNT_PASSWORD"])).toThrow(
      "missing LOADTEST_ACCOUNT_PASSWORD in tools/loadtest/.env.loadtest",
    );
  });

  it("Review Focus 1 — an empty value fails like a missing one", () => {
    const path = envFile("AUTH0_DOMAIN=t.example.test\nLOADTEST_ACCOUNT_PASSWORD=\n");
    expect(() => loadSecrets(path, ["AUTH0_DOMAIN", "LOADTEST_ACCOUNT_PASSWORD"])).toThrow(
      "missing LOADTEST_ACCOUNT_PASSWORD in tools/loadtest/.env.loadtest",
    );
  });

  it("a missing file says how to create it", () => {
    expect(() => loadSecrets(join(tmpdir(), "no-such-dir-loadtest", ".env.loadtest"), ["AUTH0_DOMAIN"])).toThrow(
      "no tools/loadtest/.env.loadtest: copy tools/loadtest/.env.example and fill it in (runbook load-testing.md)",
    );
  });

  it("never reads process.env", () => {
    process.env.AUTH0_DOMAIN = "from-the-shell.example.test";
    try {
      expect(() => loadSecrets(envFile(""), ["AUTH0_DOMAIN"])).toThrow("missing AUTH0_DOMAIN");
    } finally {
      delete process.env.AUTH0_DOMAIN;
    }
  });

  it("refuses to hand out a variable it was not asked to load", () => {
    const s = secretsFrom(FULL, ["AUTH0_DOMAIN"]);
    expect(() => s.get("LOADTEST_ACCOUNT_PASSWORD")).toThrow("LOADTEST_ACCOUNT_PASSWORD was not loaded");
  });
});

describe("AC22 — a Secrets object never prints its values", () => {
  const s = secretsFrom(FULL, SECRET_NAMES);

  it("JSON and inspect show [redacted]", () => {
    const outputs = [JSON.stringify({ s }), inspect(s), `${inspect({ nested: { s } })}`, String(s)];
    for (const out of outputs) {
      for (const value of s.values()) expect(out).not.toContain(value);
      expect(out).toContain("[redacted]");
    }
  });

  it("values() holds the secret values only, not config such as the connection name or URLs", () => {
    expect(s.values().sort()).toEqual(
      [
        FULL.LOADTEST_AUTH0_CLIENT_SECRET,
        FULL.LOADTEST_ACCOUNT_PASSWORD,
        FULL.AUTH0_MGMT_CLIENT_SECRET,
        FULL.GRAFANA_PROM_RW_TOKEN,
        FULL.GRAFANA_ANNOTATION_TOKEN,
      ].sort(),
    );
  });
});
