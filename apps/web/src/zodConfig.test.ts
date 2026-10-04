import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 04.0 §7 — the SPA's CSP has no `unsafe-eval`. Zod v4 probes
 * `new Function("")` to decide whether to JIT-compile object parsers; the probe
 * is caught, but the browser still reports every attempt as a CSP violation
 * (the M1 browser smoke's AC2 check fails on it). `zodConfig.ts` turns Zod's
 * JIT off before any schema exists, so the probe never runs.
 */
describe("Spec 04.0 CSP — Zod never reaches for the Function constructor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("after zodConfig, building and parsing an object schema never calls Function", async () => {
    const spy = vi.spyOn(globalThis, "Function");
    await import("./zodConfig");
    const { z } = await import("zod");
    const schema = z.object({ a: z.string(), b: z.number().optional() });
    expect(schema.parse({ a: "x", b: 1 })).toEqual({ a: "x", b: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("main.tsx imports zodConfig before anything else, so it runs before any schema module", () => {
    const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "main.tsx"), "utf8");
    const firstImport = main.split("\n").find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "./zodConfig";');
  });
});
