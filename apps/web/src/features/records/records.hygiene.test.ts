import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("17.6 AC18 / AC19 / 17.2 AC13 / AC35 / AC36 — the ledger is quiet and earns its brass", () => {
  const sheets = ["./RecordLedgerPanel.module.css", "./FirstTimeLines.module.css"];
  it("no animation, keyframes or transition", () => {
    for (const p of sheets) expect(strip(read(p)), p).not.toMatch(/animation|@keyframes|transition/);
  });
  it("a tint, not an outline: no border or outline", () => {
    for (const p of sheets) expect(strip(read(p)), p).not.toMatch(/\bborder(?!-radius)[a-z-]*\s*:|outline/);
  });
  it("no teal; no hard-coded color, no fixed px or width", () => {
    for (const p of sheets) {
      const css = strip(read(p));
      expect(css, p).not.toMatch(/--color-(signal|on-signal|signal-soft|selected|on-selected|warmup)\b/);
      expect(css, p).not.toMatch(/#[0-9a-f]{3,8}\b|\b\d+px\b/i);
      expect(css, p).not.toMatch(/(^|[\s{;])width:\s*\d/m);
    }
  });
  it("brass stays in the panel: the first-time lines name no --color-pr", () => {
    expect(strip(read("./FirstTimeLines.module.css"))).not.toMatch(/--color-pr/);
    expect(strip(read("./RecordLedgerPanel.module.css"))).toMatch(/--color-pr-soft/);
  });
  it("long names wrap instead of widening the panel", () => {
    expect(strip(read("./RecordLedgerPanel.module.css"))).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it("the components add no live region and no inline style", () => {
    for (const p of ["./RecordLedgerPanel.tsx", "./FirstTimeLines.tsx", "./PersonalRecordsBlock.tsx"]) {
      expect(strip(read(p)), p).not.toMatch(/aria-live|role="status"|style=\{/);
    }
  });
});
