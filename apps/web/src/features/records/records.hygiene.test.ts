import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("17.2 AC13 / AC35 / AC36 — the record cards are quiet and earn their brass", () => {
  const css = () => strip(read("./RecordCardList.module.css"));
  it("no animation, keyframes or transition", () => {
    expect(css()).not.toMatch(/animation|@keyframes|transition/);
  });
  it("a tint, not an outline: no border or outline in the card sheet", () => {
    expect(css()).not.toMatch(/\bborder(?!-radius)[a-z-]*\s*:|outline/);
  });
  it("brass only for records; no teal; no hard-coded color, no fixed px or width", () => {
    expect(css()).not.toMatch(/--color-(signal|on-signal|signal-soft|selected|on-selected|warmup)\b/);
    expect(css()).not.toMatch(/#[0-9a-f]{3,8}\b|\b\d+px\b/i);
    expect(css()).not.toMatch(/(^|[\s{;])width:\s*\d/m);
  });
  it("long names wrap instead of widening the card", () => {
    expect(css()).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it("the components add no live region and no inline style", () => {
    for (const p of ["./RecordCardList.tsx", "./PersonalRecordsBlock.tsx"]) {
      expect(strip(read(p)), p).not.toMatch(/aria-live|role="status"|style=\{/);
    }
  });
});
