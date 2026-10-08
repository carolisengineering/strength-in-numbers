import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const sources = () =>
  readdirSync(HERE)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => [f, readFileSync(join(HERE, f), "utf8")] as const);

describe("08.1 AC26 — no inline styles, no measuring, paint from CSS classes only", () => {
  it("non-test sources under features/progress", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(0);
    for (const [file, text] of files) {
      expect(text, file).not.toMatch(/\bstyle\s*=|<style|\bfill\s*=|\bstroke\s*=|ResizeObserver|getBoundingClientRect|innerWidth/);
    }
  });
});
