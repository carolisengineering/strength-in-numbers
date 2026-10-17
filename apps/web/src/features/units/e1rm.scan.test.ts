import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("17.2 AC29 — e1RM is rounded wherever it is shown", () => {
  it("record lines and the Progress headline go through the type-aware formatter", () => {
    for (const p of ["../records/labels.ts", "../progress/exercises.ts"]) {
      const src = strip(read(p));
      expect(src, p).toMatch(/formatRecordByType\(/);
      expect(src, p).not.toMatch(/formatRecordValue\(/);
    }
  });
  it("the chart point readout rounds the est. 1RM metric", () => {
    expect(strip(read("../progress/metrics.ts"))).toMatch(/metric === "est1rm"[\s\S]*roundedE1rm\(/);
  });
});
