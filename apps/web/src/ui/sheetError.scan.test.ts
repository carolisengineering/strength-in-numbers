import { describe, expect, it } from "vitest";

// Raw source of every non-test component under src.
const sources = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx", "!../test/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Each `<SheetActions ... />` element's text, up to its self-closing end. */
const sheetActionsElements = (source: string): string[] => {
  const found: string[] = [];
  let at = source.indexOf("<SheetActions");
  while (at >= 0) {
    let depth = 0;
    let end = at;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (depth === 0 && source.startsWith("/>", end)) break;
    }
    found.push(source.slice(at, end));
    at = source.indexOf("<SheetActions", end);
  }
  return found;
};

describe("minors 496, 503 — every sheet's save failure goes through SheetActions' error", () => {
  it("found the sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("no sheet passes notice, or draws its own alert, in the row", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => path !== "./SheetActions.tsx")
      .flatMap(([path, source]) => sheetActionsElements(source).filter((el) => /\bnotice=|role="alert"|tone="error"/.test(el)).map(() => path))
      .sort();
    expect(offenders).toEqual([]);
  });
});
