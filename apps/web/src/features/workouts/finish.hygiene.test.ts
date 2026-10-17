import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const NEW_TS = ["./finishStats.ts", "./FinishStatsList.tsx", "./FinishDialog.tsx"];
const NEW_CSS = ["./FinishStatsList.module.css", "./FinishDialog.module.css"];

describe("17.2 AC7 — the finish flow is not touched", () => {
  it("the new modules never name finishLock, confirmFinish or useFinishWorkout", () => {
    for (const p of NEW_TS) expect(strip(read(p)), p).not.toMatch(/finishLock|confirmFinish|useFinishWorkout/);
  });
});

describe("17.2 AC13 — the celebration is quiet", () => {
  it("the new stylesheets have no animation, keyframes or transition", () => {
    for (const p of NEW_CSS) expect(strip(read(p)), p).not.toMatch(/animation|@keyframes|transition/);
  });
  it("the new components add no live region", () => {
    for (const p of NEW_TS) expect(strip(read(p)), p).not.toMatch(/aria-live|role="status"/);
  });
});

describe("17.2 AC12 — tokens only", () => {
  it("the stats stylesheet uses the figure tokens and no fixed widths", () => {
    const css = read("./FinishStatsList.module.css");
    expect(css).toMatch(/--font-weight-figure/);
    expect(css).toMatch(/--font-stretch-figure/);
    expect(css).not.toMatch(/(^|[\s{;])width:\s*\d/m);
  });
});
