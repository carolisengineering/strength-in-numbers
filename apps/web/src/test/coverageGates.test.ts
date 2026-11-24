import { describe, expect, it } from "vitest";
import { COVERAGE_GATES, COVERAGE_PROVIDER, coverageGates } from "../../coverage-gates";

/**
 * Issue 361: CI runs the suite in shards and merges their coverage. A shard sees a fraction of the suite, so the
 * 90% gates are off in it and on everywhere else: the merge job and a local `test:coverage`.
 */
describe("issue 361 — the coverage gates are off only in a CI shard", () => {
  it("coverage is counted by the provider that sees real lines", () => {
    expect(COVERAGE_PROVIDER).toBe("istanbul");
  });
  it("ten folders and files are held at 90% lines", () => {
    expect(Object.keys(COVERAGE_GATES)).toHaveLength(10);
    for (const gate of Object.values(COVERAGE_GATES)) expect(gate).toEqual({ lines: 90 });
    expect(COVERAGE_GATES["src/api/**"]).toBeDefined();
    expect(COVERAGE_GATES["src/auth/**"]).toBeDefined();
  });
  it("the gates are on by default", () => {
    expect(coverageGates({})).toBe(COVERAGE_GATES);
  });
  it("a shard has no gates", () => {
    expect(coverageGates({ SIN_WEB_SHARD: "1" })).toBeUndefined();
  });
  it.each(["", "0", "true", "yes", " 1"])("SIN_WEB_SHARD=%j is not the switch: the gates stay on", (value) => {
    expect(coverageGates({ SIN_WEB_SHARD: value })).toBe(COVERAGE_GATES);
  });
});
