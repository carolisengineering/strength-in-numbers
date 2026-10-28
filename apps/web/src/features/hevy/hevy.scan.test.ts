import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filesUnder } from "../../test/sourceScan";

const SRC = `${join(dirname(fileURLToPath(import.meta.url)), "../..")}/`;
/** Block comments and `//` line comments; a `//` after a colon is a URL's (`https://`), not a comment. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const production = filesUnder(SRC, /\.(ts|tsx)$/)
  .map((path) => relative(SRC, path))
  .filter((path) => !/\.test\.tsx?$/.test(path) && !path.startsWith("test/"));

describe("20.0 AC7 — only the client sends the key", () => {
  it.each(["api-key", "api.hevyapp.com"])("the literal %s appears only in features/hevy/client/hevyClient.ts", (literal) => {
    const hits = production.filter((path) => stripComments(readFileSync(`${SRC}${path}`, "utf8")).includes(literal));
    expect(hits).toEqual(["features/hevy/client/hevyClient.ts"]);
  });
});
