import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source scans for Spec 17.3's system rules. Purely visual properties are checked by the screenshot harness (D17).
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The CSS declarations of `tokens.css`'s base `:root` block, and of everything after it (the dark blocks). */
function tokenBlocks() {
  const tokens = read("../ui/tokens.css");
  const start = tokens.indexOf(":root {");
  const end = tokens.indexOf("@media (prefers-color-scheme: dark)");
  return { base: tokens.slice(start, end), dark: tokens.slice(end) };
}

describe("17.3 AC1 — the old lines are gone and the tab says the name", () => {
  it("no source file carries an old landing sentence", () => {
    const old = [
      "Log your lifts. See the numbers move.",
      "Log your lifts, follow your plan, see your progress.",
      "See your progress.",
    ];
    for (const [file, text] of Object.entries(sources)) {
      for (const line of old) expect(text.includes(line), `${file} still says "${line}"`).toBe(false);
    }
  });

  it("index.html's title is Strength in Numbers", () => {
    expect(read("../../index.html")).toMatch(/<title>Strength in Numbers<\/title>/);
  });
});

describe("17.3 AC4 — Landing uses the shared Button, never a raw button", () => {
  it.each(["./Landing.tsx", "./AuthError.tsx"])("%s imports ui/Button and writes no <button", (file) => {
    const source = read(file);
    expect(source).toMatch(/from "\.\.\/ui\/Button"/);
    expect(source).not.toMatch(/<button/);
  });
});

describe("17.3 AC5 — one front door", () => {
  it("only FrontDoor renders the two-line name, and both screens use it", () => {
    const withName = Object.entries(sources)
      .filter(([, text]) => text.includes("<span>in Numbers</span>"))
      .map(([file]) => file);
    expect(withName).toEqual(["./FrontDoor.tsx"]);
    for (const screen of ["./Landing.tsx", "./ResumingSession.tsx", "./AuthError.tsx"]) {
      expect(read(screen)).toMatch(/from "\.\/FrontDoor"/);
    }
  });
});

describe("17.3 AC20 — safe areas on all four sides", () => {
  it("FrontDoor.module.css adds every safe-area inset", () => {
    const css = withoutComments(read("./FrontDoor.module.css"));
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(css).toContain(`env(safe-area-inset-${side})`);
    }
  });
});

describe("17.3 AC25 — the front door uses only ink, muted and the hairline", () => {
  it("names no color token outside text, muted and line", () => {
    const colors = [...withoutComments(read("./FrontDoor.module.css")).matchAll(/--color-[\w-]+/g)].map((m) => m[0]);
    expect(colors.length).toBeGreaterThan(0);
    expect([...new Set(colors)].filter((c) => !["--color-text", "--color-muted", "--color-line"].includes(c))).toEqual([]);
  });
});

describe("17.3 AC26 — the five front-door tokens live in the base block only", () => {
  it("defines each token once, in the base :root block, and never in a dark block", () => {
    const { base, dark } = tokenBlocks();
    for (const token of [
      "--font-size-brand",
      "--font-stretch-brand",
      "--letter-spacing-brand",
      "--landing-column-max",
      "--landing-column-max-height",
    ]) {
      expect(base).toMatch(new RegExp(`${token}\\s*:`));
      expect(dark).not.toContain(`${token}:`);
    }
  });
});
