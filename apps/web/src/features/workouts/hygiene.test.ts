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

const featureOffenders = (pattern: RegExp) =>
  Object.entries(featureSources)
    .filter(([, source]) => pattern.test(stripComments(source)))
    .map(([path]) => path);

describe("06.4 AC2 — times use hourCycle, not hour12", () => {
  it("no feature module mentions hour12 (it prints 24:05 at five past midnight)", () => {
    expect(featureOffenders(/hour12/)).toEqual([]);
  });
});

describe("06.4 AC3 — the feature reaches DOM nodes through refs, not the document", () => {
  it("no feature module queries the document", () => {
    expect(featureOffenders(/document\.(querySelector|querySelectorAll|getElementById)\b/)).toEqual([]);
  });
});

// Raw (comments included): the point is that no comment points at a review note that has gone.
const appSources = import.meta.glob(["../../**/*.ts", "../../**/*.tsx", "!../../**/*.test.ts", "!../../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("06.4 AC11 — no stale review-note references", () => {
  it("found the app sources", () => {
    expect(Object.keys(appSources).length).toBeGreaterThan(50);
  });

  it("no non-test source under apps/web/src mentions a Review Focus item", () => {
    const pattern = ["Review", "Focus"].join(" ");
    const hits = Object.entries(appSources)
      .filter(([, source]) => source.includes(pattern))
      .map(([path]) => path);
    expect(hits).toEqual([]);
  });
});
