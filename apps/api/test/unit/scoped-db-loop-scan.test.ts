// apps/api/test/unit/scoped-db-loop-scan.test.ts
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Spec 21.1 Review Focus 2 — a bare scoped call is 4 statements (BEGIN, set_config, the statement, COMMIT), so one inside
 * a loop or a `Promise.all` multiplies a request's cost. This scan lists every call made on, or handed, a `ScopedClient`
 * (never a transaction's client) inside a `for` / `while` / `do` body, an array callback (`map`, `forEach`, …) or the
 * arguments of `Promise.all`. Each one is either moved into one transaction or listed below with its bound and reason.
 * A call through a closure defined outside the loop is not seen (the scan reads where the call is written).
 */

const API = fileURLToPath(new URL("../..", import.meta.url));
const DIRS = ["src/repositories", "src/records", "src/account"];
const ARRAY_CALLBACKS = new Set(["map", "forEach", "flatMap", "filter", "reduce", "some", "every"]);

/** `file#enclosing function: what is called` → why it may stay. */
const ALLOWED: Record<string, string> = {
  "src/repositories/exercise.prisma.ts#updateExercise: loadVisibleRow":
    "the guarded UPDATE's bounded retry (≤ 2 rounds, Spec 03.4 minor 225; the UPDATE itself is the `write` closure, unseen here): re-reads why it matched nothing, only on a miss (a race or a type lock)",
  "src/repositories/exercise.prisma.ts#updateExercise: lineageHasSets":
    "the same bounded retry, only for a guarded type change that missed (≤ 2)",
  "src/repositories/hevy-import.prisma.ts#importBatch: findCandidates":
    "one duplicate-candidate read per workout of a batch (≤ 25 workouts × ≤ 2 attempts); it sits between the per-workout write transactions and also serves the dry run, which opens none",
};

interface Finding {
  key: string;
  line: number;
}

function sourceFiles(): string[] {
  return DIRS.flatMap((d) =>
    readdirSync(`${API}${d}`)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `${API}${d}/${f}`),
  );
}

function scan(): Finding[] {
  const config = ts.getParsedCommandLineOfConfigFile(`${API}tsconfig.json`, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined })!;
  const files = sourceFiles();
  const program = ts.createProgram(files, config.options);
  const checker = program.getTypeChecker();
  const isScoped = (node: ts.Node) => {
    const t = checker.getTypeAtLocation(node);
    return (t.aliasSymbol ?? t.getSymbol())?.getName() === "ScopedClient";
  };
  const findings: Finding[] = [];

  for (const file of files) {
    const sf = program.getSourceFile(file)!;
    const rel = file.slice(API.length);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) {
        const callee = ts.isCallExpression(node) ? node.expression : node.tag;
        const args = ts.isCallExpression(node) ? [...node.arguments] : [];
        const onScoped =
          ts.isPropertyAccessExpression(callee) &&
          /^\$(queryRaw|executeRaw)$/.test(callee.name.text) &&
          isScoped(callee.expression);
        const handedScoped = args.some((a) => isScoped(a));
        if ((onScoped || handedScoped) && inLoop(node)) {
          const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(sf);
          findings.push({ key: `${rel}#${enclosingName(node)}: ${name}`, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

/** Inside a loop body, an array callback, or `Promise.all(...)`'s arguments. */
function inLoop(node: ts.Node): boolean {
  let child: ts.Node = node;
  for (let p = node.parent; p; child = p, p = p.parent) {
    if ((ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) && child === p.statement) return true;
    if (ts.isCallExpression(p) && p.arguments.includes(child as ts.Expression)) {
      const c = p.expression;
      if (ts.isPropertyAccessExpression(c) && ARRAY_CALLBACKS.has(c.name.text) && (ts.isArrowFunction(child) || ts.isFunctionExpression(child))) return true;
      if (ts.isPropertyAccessExpression(c) && c.name.text === "all" && c.expression.getText() === "Promise") return true;
    }
  }
  return false;
}

function enclosingName(node: ts.Node): string {
  for (let p = node.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText();
  }
  return "(module)";
}

describe("Spec 21.1 Review Focus 2 — scoped bare calls inside loops", () => {
  const findings = scan();

  it("every scoped call inside a loop or Promise.all is on the allow-list, with its bound and reason", () => {
    expect(findings.filter((f) => !(f.key in ALLOWED))).toEqual([]);
  });

  it("every allow-list entry still matches a call (no stale entries)", () => {
    expect(Object.keys(ALLOWED).filter((k) => !findings.some((f) => f.key === k))).toEqual([]);
  });

  it("the scan sees a scoped call in a loop (it is not blind)", () => {
    expect(findings.length).toBeGreaterThan(0);
  });
});
