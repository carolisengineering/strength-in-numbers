import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const UI = dirname(fileURLToPath(import.meta.url));
const SRC = join(UI, "..");
const WEB = join(SRC, "..");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function stylesheets(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) stylesheets(path, out);
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}
const sheets = stylesheets(SRC).map((path) => ({ path, css: strip(readFileSync(path, "utf8")) }));

describe("AC9 — the font is self-hosted and declared correctly", () => {
  const fontsCss = strip(readFileSync(join(UI, "fonts.css"), "utf8"));

  it("ships the woff2 and its license in the repo", () => {
    expect(existsSync(join(UI, "fonts", "InstrumentSans-roman-latin.woff2"))).toBe(true);
    expect(readFileSync(join(UI, "fonts", "OFL.txt"), "utf8")).toMatch(/SIL Open Font License/);
  });

  it("declares the variable face with swap and a same-origin url", () => {
    expect(fontsCss).toMatch(/font-family:\s*"Instrument Sans"/);
    expect(fontsCss).toMatch(/src:\s*url\("\.\/fonts\/InstrumentSans-roman-latin\.woff2"\)\s*format\("woff2"\)/);
    expect(fontsCss).toMatch(/font-weight:\s*400 700/);
    expect(fontsCss).toMatch(/font-stretch:\s*75% 100%/);
    expect(fontsCss).toMatch(/font-display:\s*swap/);
  });

  it("loads nothing from another origin", () => {
    expect(sheets.filter((s) => /https?:\/\//.test(s.css)).map((s) => s.path)).toEqual([]);
  });

  it("puts Instrument Sans first in the font stack, with real fallbacks", () => {
    const tokens = strip(readFileSync(join(UI, "tokens.css"), "utf8"));
    expect(tokens).toMatch(/--font-family:\s*"Instrument Sans",\s*system-ui,/);
  });

  it("is loaded between the tokens and the reset", () => {
    const boot = readFileSync(join(SRC, "bootstrap.tsx"), "utf8");
    expect(boot.indexOf('"./ui/tokens.css"')).toBeLessThan(boot.indexOf('"./ui/fonts.css"'));
    expect(boot.indexOf('"./ui/fonts.css"')).toBeLessThan(boot.indexOf('"./ui/reset.css"'));
  });
});

describe("AC10 — numbers are tabular by default", () => {
  it("sets tabular figures on body", () => {
    const reset = strip(readFileSync(join(UI, "reset.css"), "utf8"));
    expect(/body\s*\{[^}]*font-variant-numeric:\s*tabular-nums/.test(reset)).toBe(true);
  });

  it("is never switched back to proportional figures", () => {
    expect(sheets.filter((s) => /font-variant-numeric:\s*(normal|proportional-nums)/.test(s.css)).map((s) => s.path)).toEqual([]);
  });
});

describe("AC5 — theme-color follows the ground of each theme", () => {
  const html = readFileSync(join(WEB, "index.html"), "utf8");
  const tokens = strip(readFileSync(join(UI, "tokens.css"), "utf8"));
  const lightBg = /:root\s*\{[^}]*--color-bg:\s*(#[0-9a-f]{6})/i.exec(tokens)![1];
  const darkBg = /prefers-color-scheme:\s*dark\)\s*\{[^}]*--color-bg:\s*(#[0-9a-f]{6})/i.exec(tokens)![1];

  it.each([
    ["light", lightBg],
    ["dark", darkBg],
  ])("the %s meta equals --color-bg", (theme, bg) => {
    const meta = new RegExp(`<meta name="theme-color" media="\\(prefers-color-scheme: ${theme}\\)" content="([^"]+)"`).exec(html);
    expect(meta?.[1]?.toLowerCase()).toBe(bg!.toLowerCase());
  });
});
