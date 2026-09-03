import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findViolations } from "../scripts/purity-check.mjs";

const script = fileURLToPath(new URL("../scripts/purity-check.mjs", import.meta.url));
const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const impureFixtures = fileURLToPath(new URL("./fixtures/impure", import.meta.url));

describe("AC2 — purity check", () => {
  it("passes on the shipped src/", () => {
    expect(findViolations(srcDir)).toEqual([]);
  });

  it("flags a Node-builtin import", () => {
    const v = findViolations(impureFixtures);
    expect(v.some((line) => line.includes('forbidden import "node:fs"'))).toBe(true);
  });

  it("flags a forbidden browser global", () => {
    const v = findViolations(impureFixtures);
    expect(v.some((line) => /forbidden global .*localStorage/.test(line))).toBe(true);
  });

  it("CLI exits 0 on the real src/ (what `pnpm run core:purity` relies on)", () => {
    expect(() => execFileSync("node", [script], { stdio: "pipe" })).not.toThrow();
  });

  it("CLI exits non-zero when pointed at an impure tree", () => {
    let code = 0;
    try {
      execFileSync("node", [script, impureFixtures], { stdio: "pipe" });
    } catch (err) {
      code = (err as { status?: number }).status ?? -1;
    }
    expect(code).toBe(1);
  });
});
