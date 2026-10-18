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
 *   of the probe's reach, so every `message:` in `src/` must be a string literal or a module constant
 *   (constant interpolations only), no issue carries `params`, and nothing sets `reportInput`.
 *
 * Not covered: a schema built inside an exported *function* (a factory) is never probed; none exists.
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
    if (def.type === "lazy" && typeof def.getter === "function") visit((def.getter as () => unknown)());
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

/** Each message function is called once per issue code × input shape, so a message that echoes only for one code or one input type is still exercised. */
const ISSUE_CODES = ["custom", "invalid_type", "too_big", "too_small", "invalid_format", "invalid_value", "unrecognized_keys"];
const SENTINEL_INPUTS: unknown[] = [SENTINEL, { value: SENTINEL }, [SENTINEL]];
const sentinelIssues = (): Record<string, unknown>[] =>
  ISSUE_CODES.flatMap((code) => SENTINEL_INPUTS.map((input) => ({ code, input, path: ["field"], keys: [SENTINEL] })));

/** The message a function returns for each sentinel issue. */
function messagesOf(fn: ErrorFn): string[] {
  return sentinelIssues().map((issue) => messageOf(fn(issue)));
}

// Every object export: a schema, or a plain object/array that holds schemas (walked by collectErrorFns).
const exportedSchemas = Object.entries(core).filter(([, value]) => typeof value === "object" && value !== null);

describe("#57 — Zod messages on exported schemas never echo the value (probe)", () => {
  it("finds the schemas and their message functions (the probe is not vacuous)", () => {
    expect(exportedSchemas.filter(([, value]) => "_zod" in (value as object)).length).toBeGreaterThan(20);
    expect(exportedSchemas.flatMap(([, schema]) => collectErrorFns(schema)).length).toBeGreaterThan(5);
  });

  it.each(exportedSchemas)("%s", (_name, schema) => {
    for (const fn of collectErrorFns(schema)) {
      for (const message of messagesOf(fn)) expect(message).not.toContain(SENTINEL);
    }
  });

  it("catches an echoing message in every form Zod accepts (control)", () => {
    const echo = (iss: { input?: unknown }) => `saw ${String(iss.input)}`;
    const echoOnTypeError = (iss: { code?: unknown; input?: unknown }) =>
      iss.code === "invalid_type" ? `got ${JSON.stringify(iss.input)}` : "wrong";
    const planted = [
      z.object({ a: z.string().max(3, { error: echo }) }),
      z.string().refine(() => false, { error: echo }),
      z.array(z.string().min(1, { error: echo })).optional(),
      z.union([z.number(), z.string({ error: echo })]),
      z.string().pipe(z.string().refine(() => false, { message: SENTINEL })),
      z.number({ error: echoOnTypeError }),
      { nested: { schema: z.string({ error: echo }) } }, // a schema inside an exported plain object
    ];
    for (const schema of planted) {
      const messages = collectErrorFns(schema).flatMap(messagesOf);
      expect(messages.some((m) => m.includes(SENTINEL))).toBe(true);
    }
  });
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

/** Every source file: an issue list can be built in a helper that never imports zod (`exercise.ts`'s muscle rule). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** A string literal, or a template whose `${…}` are UPPER_SNAKE names, or a bare UPPER_SNAKE name — and nothing after it (no `+ value`, no ternary). The names are checked separately to be module constants. */
const STATIC_MESSAGE = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`$\\]|\\.|\$\{[A-Z][A-Z0-9_]*\})*`|[A-Z][A-Z0-9_]*)\s*[,}\n)]/;

/** Comments, so prose such as `// message: …` neither trips nor satisfies the scan. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** An UPPER_SNAKE name counts as static only when it is a top-level `const` or an import in that file — not a loop variable or a destructured value. */
function isModuleConstant(source: string, name: string): boolean {
  return (
    new RegExp(`^(?:export )?const ${name}\\b`, "m").test(source) ||
    new RegExp(`^import [^;]*\\b${name}\\b[^;]*from`, "m").test(source)
  );
}

/** `message:` values that are not literals, per file, each checked elsewhere. `string` (a type annotation) is allowed everywhere. */
const ALLOWED_MESSAGE_EXPRESSIONS: Record<string, readonly string[]> = {
  "dto/exercise.ts": ["issue.message"], // re-issues `muscleIdCrossFieldIssues`, whose messages are literals scanned here
  "supersets.ts": ["applied.cap"], // the editor's `LINK_CAP_MESSAGE`, never a Zod issue
};

describe("#57 — issue messages built in code are static (source scan)", () => {
  const files = sourceFiles(SRC);

  it("scans every source file, the Zod schema files among them", () => {
    expect(files.filter((f) => /from ["']zod(?:\/[^"']*)?["']/.test(readFileSync(f, "utf8"))).length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s", (name, file) => {
    const source = stripComments(readFileSync(file, "utf8"));
    expect(source).not.toMatch(/\breportInput\b/);
    expect(source).not.toMatch(/\bparams\s*:/);
    expect(source, "shorthand `{ message }` hides the value it carries").not.toMatch(/[{,]\s*message\s*[,}]/);
    expect(source, "addIssue must take an object literal, so its message is scanned here").not.toMatch(/\baddIssue\(\s*(?!\{)/);
    expect(source, "a spread into addIssue can carry an unscanned message").not.toMatch(/\baddIssue\(\s*\{[^}]*\.\.\./);
    expect(source, "`.check()`'s ctx.issues.push must take an object literal").not.toMatch(/\.issues\.push\(\s*(?!\{)/);
    const allowed = new Set(["string", ...(ALLOWED_MESSAGE_EXPRESSIONS[name] ?? [])]);
    for (const match of source.matchAll(/\bmessage\s*:\s*/g)) {
      const rest = source.slice(match.index + match[0].length);
      if (STATIC_MESSAGE.test(rest)) {
        const literal = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|[A-Z][A-Z0-9_]*)/.exec(rest)![0];
        const names = [...literal.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]!);
        if (/^[A-Z]/.test(literal)) names.push(literal);
        for (const constant of names) {
          expect(isModuleConstant(source, constant), `${constant} in ${name} is not a module constant`).toBe(true);
        }
        continue;
      }
      const expression = /^[\w.]+/.exec(rest)?.[0] ?? rest.slice(0, 40);
      expect(allowed, `non-static message in ${name}: ${expression}`).toContain(expression);
    }
  });
});
