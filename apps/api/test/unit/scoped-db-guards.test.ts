// apps/api/test/unit/scoped-db-guards.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Spec 21.1 AC14, AC16, AC20 — the static guards that keep "who is asking" on every statement:
 * - AC14: no repository, auth, records or account module runs SQL on a bare `PrismaClient`;
 * - AC16: `shared()` is called only for the shared reference reads (and the operator scripts' cross-user listings);
 * - AC20: the composition root hands every repository factory the scoped handle, never the bare client.
 * A type-aware scan (the TypeScript checker), so a renamed variable cannot hide a bare client.
 */

const API = fileURLToPath(new URL("../..", import.meta.url));
const GUARDED_DIRS = ["src/repositories", "src/auth", "src/records", "src/account"];

function filesIn(dirs: readonly string[]): string[] {
  return dirs.flatMap((d) =>
    readdirSync(`${API}${d}`)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `${API}${d}/${f}`),
  );
}

function program(files: readonly string[]): ts.Program {
  const config = ts.getParsedCommandLineOfConfigFile(`${API}tsconfig.json`, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined })!;
  return ts.createProgram(files, config.options);
}

const rel = (file: string) => file.slice(API.length);
const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function enclosingName(node: ts.Node): string {
  for (let p = node.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText();
  }
  return "(module)";
}

/** AC14: `.$queryRaw` / `.$executeRaw` / `.$transaction` (and their Unsafe forms) on a receiver typed `PrismaClient`. */
export function bareClientCalls(files: readonly string[]): string[] {
  const p = program(files);
  const checker = p.getTypeChecker();
  const out: string[] = [];
  for (const file of files) {
    const sf = p.getSourceFile(file)!;
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && /^\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe|transaction)$/.test(node.name.text)) {
        const t = checker.getTypeAtLocation(node.expression);
        const names = (t.isUnion() ? t.types : [t]).map((x) => (x.aliasSymbol ?? x.getSymbol())?.getName());
        if (names.includes("PrismaClient")) out.push(`${rel(file)}:${lineOf(sf, node)} ${node.getText(sf).slice(0, 60)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** AC16: every `.shared()` call outside the handle itself, as `file#enclosing function`. */
function sharedCallSites(files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "shared" && node.arguments.length === 0) {
        out.add(`${rel(file)}#${enclosingName(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...out].sort();
}

describe("Spec 21.1 AC14 — no SQL on a bare PrismaClient in the guarded modules", () => {
  it("src/repositories, src/auth, src/records and src/account never call $queryRaw / $executeRaw / $transaction on a PrismaClient", () => {
    expect(bareClientCalls(filesIn(GUARDED_DIRS))).toEqual([]);
  });

  it("the scan sees a bare client where there is one (src/db.ts's readiness probe, outside the guarded modules)", () => {
    expect(bareClientCalls([`${API}src/db.ts`]).some((s) => s.includes("checkDatabaseReady") || s.includes("$queryRaw"))).toBe(true);
  });
});

describe("Spec 21.1 AC16 — shared() is only for the shared reference reads", () => {
  it("the call sites are exactly the exercise reference reads and the operator scripts' cross-user listings", () => {
    expect(sharedCallSites(filesIn(["src/repositories", "src/auth", "src/records", "src/account", "src/routes", "src/hevy"]))).toEqual([
      "src/account/purge.ts#runPurge",
      "src/records/rebuild.ts#rebuildRecords",
      "src/repositories/exercise.prisma.ts#listEquipment",
      "src/repositories/exercise.prisma.ts#listMuscleGroups",
      "src/repositories/exercise.prisma.ts#validateReferences",
    ]);
  });

  it("the audit classifies the reference reads shared on purpose, and the listings cross-user maintenance", () => {
    const audit = readFileSync(`${API}../../docs/security/query-audit.md`, "utf8");
    const category = (key: string) => new RegExp("\\| `" + key.replace(/[$#.]/g, "\\$&") + "` \\| \\w+ \\| ([^|]+) \\|").exec(audit)?.[1]?.trim();
    for (const k of [
      "src/repositories/exercise.prisma.ts#validateReferences#1",
      "src/repositories/exercise.prisma.ts#validateReferences#2",
      "src/repositories/exercise.prisma.ts#listMuscleGroups#1",
      "src/repositories/exercise.prisma.ts#listEquipment#1",
    ]) {
      expect([k, category(k)]).toEqual([k, "shared on purpose"]);
    }
    expect(category("src/records/rebuild.ts#rebuildRecords#1")).toBe("cross-user maintenance");
    expect(category("src/account/purge.ts#listEligible#1")).toBe("cross-user maintenance");
  });
});

describe("Spec 21.1 AC20 — server.ts wires every repository from createScopedDb", () => {
  const file = `${API}src/server.ts`;
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const scopedNames = new Set<string>();
  const factoryCalls: { name: string; firstArg: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(sf) === "createScopedDb") {
      scopedNames.add(node.name.getText(sf));
    }
    if (ts.isCallExpression(node) && /^create\w+Repository$/.test(node.expression.getText(sf))) {
      factoryCalls.push({ name: node.expression.getText(sf), firstArg: node.arguments[0]?.getText(sf) ?? "" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  it("every repository factory gets the handle createScopedDb returned", () => {
    expect(factoryCalls.length).toBeGreaterThanOrEqual(8);
    expect(factoryCalls.filter((c) => !scopedNames.has(c.firstArg))).toEqual([]);
  });

  it("the bare client reaches only the readiness probe, the pool metrics, the handle and the shutdown", () => {
    const uses: string[] = [];
    const find = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === "prisma" && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)) {
        let call: ts.Node = node;
        while (call.parent && !ts.isCallExpression(call)) call = call.parent;
        uses.push(ts.isCallExpression(call) ? call.expression.getText(sf) : node.parent.getText(sf));
      }
      ts.forEachChild(node, find);
    };
    find(sf);
    expect([...new Set(uses)].sort()).toEqual(["checkDatabaseReady", "createGracefulShutdown", "createScopedDb", "wirePoolMetrics"]);
  });
});
