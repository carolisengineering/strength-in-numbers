import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { filesUnder, stripCssComments } from "../test/sourceScan";

// Spec 17.0 §6.7: the token set and its contrast, checked from tokens.css itself in both themes.
const UI = dirname(fileURLToPath(import.meta.url));
const SRC = join(UI, "..");
const css = stripCssComments(readFileSync(join(UI, "tokens.css"), "utf8"));

type Block = Record<string, string>;

function declarations(body: string): Block {
  const out: Block = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function blockAfter(selectorPattern: RegExp): string | null {
  const m = selectorPattern.exec(css);
  if (!m) return null;
  const start = css.indexOf("{", m.index) + 1;
  return css.slice(start, css.indexOf("}", start));
}

const base = declarations(blockAfter(/(^|\n)\s*:root\s*\{/)!);
const darkMediaBlocks = [...css.matchAll(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/g)];
const darkMedia = declarations(darkMediaBlocks[0]?.[1] ?? "");
const darkAttr = declarations(blockAfter(/:root\[data-theme="dark"\]\s*\{/) ?? "");

const colorKeys = (b: Block) => Object.keys(b).filter((k) => k.startsWith("--color-"));
const literalColorKeys = colorKeys(base).filter((k) => /^#[0-9a-f]{6}$/i.test(base[k]!));

function resolve(theme: Block, key: string): string {
  let value = theme[key];
  for (let i = 0; value?.startsWith("var(") && i < 5; i++) value = theme[/var\((--[\w-]+)\)/.exec(value)![1]!];
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${key} does not resolve to a hex color (${value})`);
  return value;
}

const light: Block = { ...base };
const dark: Block = { ...base, ...darkMedia };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// [foreground, backgrounds, minimum, what it is]
const PAIRS: Array<[string, string[], number, string]> = [
  ["--color-text", ["--color-bg", "--color-surface", "--color-surface-raised", "--color-pr-soft", "--color-signal-soft"], 4.5, "body text, record lines, selected text"],
  ["--color-muted", ["--color-bg", "--color-surface", "--color-surface-raised", "--color-signal-soft"], 4.5, "secondary text (also the current-set panel's labels, Spec 17.1)"],
  ["--color-warmup", ["--color-bg", "--color-surface", "--color-surface-raised"], 4.5, "warm-up set text"],
  ["--color-on-signal", ["--color-signal"], 4.5, "primary button / selected chip text"],
  ["--color-signal", ["--color-bg", "--color-surface", "--color-surface-raised", "--color-signal-soft"], 4.5, "links, nav label, CTA text"],
  ["--color-on-selected", ["--color-selected"], 4.5, "text on a chosen option"],
  ["--color-pr", ["--color-bg", "--color-surface", "--color-pr-soft"], 4.5, "record text"],
  ["--color-danger", ["--color-bg", "--color-surface", "--color-surface-raised", "--color-signal-soft"], 4.5, "errors, destructive (also field errors in the current-set panel)"],
  ["--color-success", ["--color-bg", "--color-surface", "--color-surface-raised"], 4.5, "saved"],
  ["--color-warning", ["--color-bg", "--color-surface", "--color-surface-raised"], 4.5, "needs attention"],
  ["--color-border", ["--color-bg", "--color-surface", "--color-surface-raised", "--color-signal-soft"], 3, "control boundary (1.4.11), also inside the tinted current-set panel (Spec 17.1 D18)"],
  ["--color-focus", ["--color-bg", "--color-surface", "--color-surface-raised"], 3, "focus ring"],
  ["--color-signal", ["--color-bg", "--color-surface"], 3, "superset bracket, chart stroke"],
];

// Decorative only: no control or information depends on seeing them (AC4).
const EXEMPT = new Set(["--color-line"]);

describe("AC1 — the Stone token set", () => {
  const required = [
    "--color-bg", "--color-surface", "--color-surface-raised", "--color-text", "--color-muted", "--color-border",
    "--color-line", "--color-signal", "--color-on-signal", "--color-signal-soft", "--color-pr", "--color-pr-soft",
    "--color-warmup", "--color-danger", "--color-success", "--color-warning", "--color-focus", "--color-selected",
    "--color-on-selected",
  ];

  it.each(required)("defines %s in both themes", (token) => {
    expect(() => resolve(light, token)).not.toThrow();
    expect(() => resolve(dark, token)).not.toThrow();
  });

  it("has no --color-accent / --color-on-accent anywhere in src", () => {
    const offenders = filesUnder(SRC, /\.(css|tsx?)$/)
      .filter((path) => !path.endsWith(".test.ts"))
      .filter((path) => /--color-(on-)?accent\b/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("AC2 — light is the base, dark follows the OS", () => {
  it("declares color-scheme: light dark on the base :root", () => {
    expect(blockAfter(/(^|\n)\s*:root\s*\{/)).toMatch(/color-scheme:\s*light dark/);
  });

  it("has exactly one dark media block and no light media block", () => {
    expect(darkMediaBlocks).toHaveLength(1);
    expect(css).not.toMatch(/prefers-color-scheme:\s*light/);
  });

  it("redefines every literal color token in the dark blocks", () => {
    expect(colorKeys(darkMedia).sort()).toEqual([...literalColorKeys].sort());
  });

  it("lets an explicit light choice beat a dark OS", () => {
    expect(blockAfter(/:root\[data-theme="light"\]\s*\{/)).toMatch(/color-scheme:\s*light/);
  });
});

describe("AC20 — both dark blocks agree", () => {
  it("carries identical declarations in the media block and the data-theme block", () => {
    expect(darkAttr).toEqual(darkMedia);
  });
});

describe("AC3 — contrast meets WCAG 2.2 AA in both themes", () => {
  const rows = PAIRS.flatMap(([fg, bgs, min, what]) => bgs.map((bg) => [fg, bg, min, what] as const));
  for (const [themeName, theme] of [["light", light], ["dark", dark]] as const) {
    it.each(rows)(`${themeName}: %s on %s ≥ %s (%s)`, (fg, bg, min) => {
      expect(contrast(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(min);
    });
  }
});

describe("AC4 — no untested color", () => {
  it("puts every literal color token in a pair or on the exemption list", () => {
    const covered = new Set(PAIRS.flatMap(([fg, bgs]) => [fg, ...bgs]));
    expect(literalColorKeys.filter((k) => !covered.has(k) && !EXEMPT.has(k))).toEqual([]);
  });
});
