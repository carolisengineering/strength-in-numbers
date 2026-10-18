import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as core from "../src/index.js";

/**
 * Issue #57 — every Zod issue message in `@sin/core` must be static: never an echo of the parsed
 * value. A `custom` issue's message is returned verbatim in the 422 body (`zodIssueMessage` in
 * `apps/api/src/errors/problem.ts`, Spec 03.0 AC2), and Spec 01 §7 keeps `email` / `display_name`
 * out of the logs (the API's err serializer also scrubs them, but the 422 body has no such net).
 *
 * Two halves, because Zod keeps messages in two places:
 * - **Probe:** every message given to a schema or check — positional (`.refine(fn, "…")`,
 *   `.max(3, "…")`) or `{ message }` / `{ error }` — is stored as a `def.error` function. Each one
 *   found on an exported schema is called with an issue whose `input` is a sentinel.
 * - **Source scan:** a `superRefine`'s `ctx.addIssue({ message })` runs inside the refinement, out
 *   of the probe's reach, so those messages must be string literals (constant interpolations only),
 *   no issue carries `params`, and nothing sets `reportInput`.
 */

const SENTINEL = "SENTINEL-57-value";

type ErrorFn = (issue: Record<string, unknown>) => unknown;

/** Every `def.error` function reachable from `root`, through shapes, wrappers, unions, pipes and checks. */
function collectErrorFns(root: unknown): ErrorFn[] {
  const found: ErrorFn[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const def = (node as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    if (def === undefined) {
      Object.values(node).forEach(visit); // a plain object, e.g. an object schema's `shape`
      return;
    }
    if (typeof def.error === "function") found.push(def.error as ErrorFn);
    for (const [key, value] of Object.entries(def)) {
      if (key !== "error") visit(value);
    }
  };
  visit(root);
  return found;
}

function messageOf(result: unknown): string {
  if (typeof result === "string") return result;
  if (typeof result === "object" && result !== null) return String((result as { message?: unknown }).message ?? "");
  return "";
}

const sentinelIssue = (): Record<string, unknown> => ({ code: "custom", input: SENTINEL, path: ["field"] });

const exportedSchemas = Object.entries(core).filter(([, value]) => typeof value === "object" && value !== null && "_zod" in value);

describe("#57 — Zod messages on exported schemas never echo the value (probe)", () => {
  it("finds the schemas and their message functions (the probe is not vacuous)", () => {
    expect(exportedSchemas.length).toBeGreaterThan(20);
    expect(exportedSchemas.flatMap(([, schema]) => collectErrorFns(schema)).length).toBeGreaterThan(5);
  });

  it.each(exportedSchemas)("%s", (_name, schema) => {
    for (const fn of collectErrorFns(schema)) {
      expect(messageOf(fn(sentinelIssue()))).not.toContain(SENTINEL);
    }
  });

  it("catches an echoing message in every form Zod accepts (control)", () => {
    const echo = (iss: { input?: unknown }) => `saw ${String(iss.input)}`;
    const planted = [
      z.object({ a: z.string().max(3, { error: echo }) }),
      z.string().refine(() => false, { error: echo }),
      z.array(z.string().min(1, { error: echo })).optional(),
      z.union([z.number(), z.string({ error: echo })]),
      z.string().pipe(z.string().refine(() => false, { message: SENTINEL })),
    ];
    for (const schema of planted) {
      const messages = collectErrorFns(schema).map((fn) => messageOf(fn(sentinelIssue())));
      expect(messages.some((m) => m.includes(SENTINEL))).toBe(true);
    }
  });
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

function zodSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return zodSourceFiles(path);
    if (!entry.name.endsWith(".ts")) return [];
    return /from ["']zod["']/.test(readFileSync(path, "utf8")) ? [path] : [];
  });
}

/** A string literal, or a template whose `${…}` are all UPPER_SNAKE constants. */
const STATIC_MESSAGE = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`$\\]|\\.|\$\{[A-Z][A-Z0-9_]*\})*`)/;

/** `message:` values that are not literals but are checked elsewhere. */
const ALLOWED_MESSAGE_EXPRESSIONS = new Set([
  "string", // a type annotation (`message: string;`)
  "issue.message", // exercise.ts re-issues its own literal-only issue list (scanned here too)
]);

describe("#57 — superRefine issue messages are static (source scan)", () => {
  const files = zodSourceFiles(SRC);

  it("scans the Zod schema files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s", (_name, file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/\breportInput\b/);
    expect(source).not.toMatch(/\bparams\s*:/);
    for (const match of source.matchAll(/\bmessage\s*:\s*/g)) {
      const rest = source.slice(match.index + match[0].length);
      if (STATIC_MESSAGE.test(rest)) continue;
      const expression = /^[\w.]+/.exec(rest)?.[0] ?? rest.slice(0, 40);
      expect(ALLOWED_MESSAGE_EXPRESSIONS, `non-static message in ${file}: ${expression}`).toContain(expression);
    }
  });
});
