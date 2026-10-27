import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { filesUnder } from "../../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sources = filesUnder(SRC, /\.tsx?$/)
  .filter((p) => !/\.test\.tsx?$/.test(p) && !p.includes(`${join("src", "test")}/`))
  .map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));

describe("18.2 AC4 — no stale links", () => {
  it("only router.tsx mentions /app/progress, and only in comments", () => {
    expect(sources.length).toBeGreaterThan(100);
    const hits = sources.filter((s) => s.text.includes("/app/progress")).map((s) => s.path);
    expect(hits).toEqual(["app/router.tsx"]);
    const router = sources.find((s) => s.path === "app/router.tsx")!.text;
    const lines = router.split("\n").filter((l) => l.includes("/app/progress"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.trim()).toMatch(/^(\*|\/\/)/);
  });
});

describe("18.2 AC26 — import boundaries", () => {
  it("progress/ never imports exercises/", () => {
    const offenders = sources
      .filter((s) => s.path.startsWith("features/progress/") && /from\s+["']\.\.\/exercises\//.test(s.text))
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("only the catalog store writes /v1/exercises (PATCH, DELETE, fork)", () => {
    const writes = /\.(patch|delete)\(\s*[`"']\/v1\/exercises/;
    const fork = /\/v1\/exercises\/[^`"'\s]*\/fork/;
    const offenders = sources
      .filter((s) => s.path !== "features/catalog/catalogStore.ts" && (writes.test(s.text) || fork.test(s.text)))
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("ProgressScreen.tsx is gone", () => {
    expect(existsSync(join(SRC, "features/progress/ProgressScreen.tsx"))).toBe(false);
  });
});
