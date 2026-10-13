import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("AC20 — one grace constant", () => {
  it("apps/api/src neither redefines ACCOUNT_PURGE_GRACE_DAYS nor writes a 30-day interval in SQL", () => {
    for (const f of files(SRC)) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/ACCOUNT_PURGE_GRACE_DAYS\s*=/);
      expect(text, f).not.toMatch(/interval\s*'30/i);
      expect(text, f).not.toMatch(/'30 days'/i);
    }
  });
});
