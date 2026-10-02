import { describe, expect, it } from "vitest";

// Raw source of every non-test module in the feature folder, plus the two new primitives.
const featureSources = import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.ts", "!./*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const primitiveSources = import.meta.glob(["../../ui/ConfirmDialog.tsx", "../../ui/InlineNotice.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
/** Code only: a comment that explains why something is avoided is not a use of it. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const sources = Object.fromEntries(
  Object.entries({ ...featureSources, ...primitiveSources }).map(([path, source]) => [path, stripComments(source)]),
);

const offenders = (pattern: RegExp) =>
  Object.entries(sources)
    .filter(([, source]) => pattern.test(source))
    .map(([path]) => path);

describe("AC34 — no inline styles; tokens stay central", () => {
  it("found the sources it is meant to scan", () => {
    expect(Object.keys(featureSources).length).toBeGreaterThan(10);
    expect(Object.keys(primitiveSources)).toHaveLength(2);
  });

  it("no JSX style prop anywhere in the feature or the two new primitives (the production CSP is style-src 'self')", () => {
    expect(offenders(/<[A-Za-z][^>]*\sstyle\s*=/)).toEqual([]);
    expect(offenders(/\.style\.|setAttribute\(\s*["']style["']/)).toEqual([]);
  });

  it("numeric fields are never type=number; nothing sets inner HTML", () => {
    expect(offenders(/type=["']number["']/)).toEqual([]);
    expect(offenders(/dangerouslySetInnerHTML/)).toEqual([]);
  });

  it("the project word rule holds: the placeholder word is never used", () => {
    const banned = ["dum", "my"].join("");
    expect(offenders(new RegExp(banned, "i"))).toEqual([]);
  });
});
