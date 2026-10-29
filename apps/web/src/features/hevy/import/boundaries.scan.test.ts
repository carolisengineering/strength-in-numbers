import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { filesUnder } from "../../../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../..");
/** Block comments and `//` line comments; a `//` after a colon is a URL's, not a comment. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const production = filesUnder(SRC, /\.(ts|tsx)$/)
  .map((path) => relative(SRC, path))
  .filter((path) => !/\.test\.tsx?$/.test(path) && !path.startsWith("test/"));
const read = (path: string) => stripComments(readFileSync(join(SRC, path), "utf8"));
const importsFrom = (source: string) => [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
const importsHevyImport = (path: string) =>
  importsFrom(read(path)).some((spec) => /(^|\/)hevy\/import(\/|$)/.test(spec) || (path.startsWith("features/hevy/") && /^\.\.?\/import\//.test(spec)) || (path.startsWith("features/hevy/import/") && spec.startsWith("./")));
const IMPORT_DIR = "features/hevy/import/";

describe("20.1 AC15 — no storage, no key in a URL", () => {
  const own = production.filter((path) => path.startsWith(IMPORT_DIR));

  it("no import module names browser storage or the storage adapter", () => {
    const hits = own.filter((path) => /\b(localStorage|sessionStorage|StorageAdapter|useStorage)\b/.test(read(path)));
    expect(own.length).toBeGreaterThan(10);
    expect(hits).toEqual([]);
  });

  it("no import module builds a URL with a key", () => {
    expect(own.filter((path) => /[?&](api[-_]?key|key)=/i.test(read(path)))).toEqual([]);
  });
});

describe("20.1 AC30 — import boundaries", () => {
  it("only hevyImportClient.ts names /v1/hevy/import", () => {
    expect(production.filter((path) => read(path).includes("/v1/hevy/import"))).toEqual([`${IMPORT_DIR}hevyImportClient.ts`]);
  });

  it("features/workouts and features/routines never import the import", () => {
    const hits = production.filter((path) => (path.startsWith("features/workouts/") || path.startsWith("features/routines/")) && importsHevyImport(path));
    expect(hits).toEqual([]);
  });

  it("only features/hevy and app/router.tsx import it", () => {
    const hits = production.filter((path) => !path.startsWith(IMPORT_DIR) && importsHevyImport(path));
    expect(hits.every((path) => path.startsWith("features/hevy/") || path === "app/router.tsx")).toBe(true);
    expect(hits).toContain("app/router.tsx");
    expect(hits).toContain("features/hevy/HevyScreen.tsx");
  });
});
