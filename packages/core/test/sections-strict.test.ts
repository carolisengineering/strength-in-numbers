// packages/core/test/sections-strict.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOTS = ["../src", "../../../apps/web/src"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe("AC26 — no .default( / .catch( on the section response fields in core or web source", () => {
  it("scan", () => {
    for (const f of ROOTS.flatMap(files)) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\b(sections|sectionId|routineNotes)\s*:\s*[^,;\n]*\.(default|catch)\(/);
    }
  });
});
