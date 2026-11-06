import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Spec 16 AC1 / plan Task 1 — k6 runs `k6/run.ts` and the `src/plan/` modules it imports in its own runtime,
 * which cannot resolve npm packages or Node built-ins. So those files may import only relative paths (type-only
 * imports are erased and allowed), plus `k6` / `k6/*` inside `k6/`.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });

const IMPORT = /^\s*(import|export)\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s+["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function badImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const inK6 = relative(root, file).startsWith("k6");
  const specifiers = [
    ...[...text.matchAll(IMPORT)].map((m) => m[2]!),
    ...[...text.matchAll(SIDE_EFFECT_IMPORT)].map((m) => m[1]!),
    ...[...text.matchAll(DYNAMIC_IMPORT)].map((m) => m[1]!),
  ];
  return specifiers.filter(
    (s) => !(s.startsWith("./") || s.startsWith("../") || (inK6 && (s === "k6" || s.startsWith("k6/")))),
  );
}

describe("AC1 — k6-loadable modules import only relative paths", () => {
  const files = [...walk(join(root, "src/plan")), ...walk(join(root, "k6"))];

  it("finds the modules to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(root, f), f]))("%s", (_name, file) => {
    expect(badImports(file)).toEqual([]);
  });

  it("the scan catches a bare import (it can fail)", () => {
    const probe = 'import { z } from "zod";\nimport http from "k6/http";\n';
    const found = [...probe.matchAll(IMPORT)].map((m) => m[2]!).filter((s) => !s.startsWith("."));
    expect(found).toContain("zod");
  });
});
