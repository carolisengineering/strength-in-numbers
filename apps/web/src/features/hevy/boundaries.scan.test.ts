import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filesUnder } from "../../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");
/** Block comments and `//` line comments; a `//` after a colon is a URL's, not a comment. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const production = filesUnder(SRC, /\.(ts|tsx)$/)
  .map((path) => relative(SRC, path))
  .filter((path) => !/\.test\.tsx?$/.test(path) && !path.startsWith("test/"));
const read = (path: string) => stripComments(readFileSync(join(SRC, path), "utf8"));
const importsFrom = (source: string) => [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

describe("20.0 AC31 — import boundaries", () => {
  it("no features/hevy file imports from features/routines", () => {
    const hits = production
      .filter((path) => path.startsWith("features/hevy/"))
      .filter((path) => importsFrom(read(path)).some((spec) => /(^|\/)routines\//.test(spec)));
    expect(hits).toEqual([]);
  });

  it("only features/hevy/client names api.hevyapp.com", () => {
    const hits = production.filter((path) => !path.startsWith("features/hevy/client/") && read(path).includes("api.hevyapp.com"));
    expect(hits).toEqual([]);
  });

  it("no features/catalog file imports from features/hevy", () => {
    const hits = production
      .filter((path) => path.startsWith("features/catalog/"))
      .filter((path) => importsFrom(read(path)).some((spec) => /(^|\/)hevy\//.test(spec)));
    expect(hits).toEqual([]);
  });
});
