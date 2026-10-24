import { describe, expect, it } from "vitest";
import { checkCommit, checkCorsPreflight } from "../../scripts/lib/smoke-checks.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";

describe("15 AC20 — checkCommit", () => {
  it("a match is ok", () => expect(checkCommit({ status: "ok", commit: SHA }, SHA)).toBeNull());
  it("a mismatch names both values", () => {
    const msg = checkCommit({ status: "ok", commit: OTHER }, SHA);
    expect(msg).toContain(SHA);
    expect(msg).toContain(OTHER);
  });
  it("a missing field fails", () => expect(checkCommit({ status: "ok" }, SHA)).toMatch(/commit/));
  it("dev against an expected SHA fails", () => expect(checkCommit({ status: "ok", commit: "dev" }, SHA)).not.toBeNull());
  it("no expectation is ok", () => expect(checkCommit({ status: "ok" }, undefined)).toBeNull());
  it("a non-object body fails when a commit is expected", () => expect(checkCommit("nope", SHA)).not.toBeNull());
});

describe("15 AC20 — checkCorsPreflight", () => {
  const H = (h: Record<string, string>) => new Headers(h);
  const ORIGIN = "https://sin-prod.web.app";
  it("the exact origin with GET is ok", () =>
    expect(checkCorsPreflight(H({ "access-control-allow-origin": ORIGIN, "access-control-allow-methods": "GET,POST,PATCH" }), ORIGIN)).toBeNull());
  it("a wildcard fails", () => expect(checkCorsPreflight(H({ "access-control-allow-origin": "*", "access-control-allow-methods": "GET" }), ORIGIN)).not.toBeNull());
  it("another origin fails", () =>
    expect(checkCorsPreflight(H({ "access-control-allow-origin": "https://evil.example", "access-control-allow-methods": "GET" }), ORIGIN)).not.toBeNull());
  it("a missing allow-origin fails", () => expect(checkCorsPreflight(H({ "access-control-allow-methods": "GET" }), ORIGIN)).not.toBeNull());
  it("methods without GET fail", () => expect(checkCorsPreflight(H({ "access-control-allow-origin": ORIGIN, "access-control-allow-methods": "POST" }), ORIGIN)).not.toBeNull());
});
