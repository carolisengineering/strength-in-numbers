import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const REST_SOURCES = ["./restTimer.ts", "./restStore.ts", "./useRestTimer.ts", "./useNow.ts", "./RestReadout.tsx", "./RestLine.tsx"];

describe("17.1 AC48 — no sound, vibration, notification or service worker", () => {
  it("the new files use none of them", () => {
    for (const p of REST_SOURCES) expect(strip(read(p)), p).not.toMatch(/navigator\.vibrate|\bNotification\b|\bAudio\b|AudioContext|serviceWorker/);
  });
  it("the readout is a timer, not a live region", () => {
    expect(read("./RestReadout.tsx")).toMatch(/role="timer"/);
    expect(strip(read("./RestReadout.tsx"))).not.toMatch(/aria-live/);
  });
});

describe("17.1 AC51 — hygiene", () => {
  it("no new file tracks, logs to the console, or reports anything but the store's static source", () => {
    for (const p of REST_SOURCES) {
      const src = strip(read(p));
      expect(src, p).not.toMatch(/\btrack\(|console\./);
      if (p !== "./restStore.ts") expect(src, p).not.toMatch(/reportError|reportUnexpected/);
    }
    const reports = [...strip(read("./restStore.ts")).matchAll(/reportError\(([^)]*)\)/g)].map((m) => m[1]);
    expect(reports).toEqual(['error, { source: "workout-rest" }']);
  });
  it("the key sits under an existing prefix and no module names browser storage", () => {
    expect(read("./restStore.ts")).toMatch(/"sin:workout:rest"/);
    for (const p of REST_SOURCES) expect(strip(read(p)), p).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("17.1 AC54 — the rest line roles", () => {
  it("RestLine.module.css uses only --color-signal and --color-line", () => {
    const colors = [...read("./RestLine.module.css").matchAll(/var\((--color-[\w-]+)\)/g)].map((m) => m[1]);
    expect(new Set(colors)).toEqual(new Set(["--color-signal", "--color-line"]));
  });
  it("the readout uses no teal", () => {
    expect(read("./RestReadout.module.css")).not.toMatch(/--color-(signal|on-signal|signal-soft|selected|on-selected)\b/);
  });
});

describe("17.1 AC52 — rest and clock code reads time through an injectable now()", () => {
  it("no new module calls Date.now() except as the default of an injectable now", () => {
    for (const p of REST_SOURCES) {
      const calls = strip(read(p)).match(/Date\.now\(\)/g) ?? [];
      expect(calls, p).toEqual([]);
    }
  });
});
