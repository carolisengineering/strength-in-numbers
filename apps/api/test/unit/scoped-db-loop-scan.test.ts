// apps/api/test/unit/scoped-db-loop-scan.test.ts
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { apiProgram, overlayPath, rel, srcFiles, srcProgram } from "./helpers/ts-program.js";

/**
 * Spec 21.1 Review Focus 2 — a bare scoped call is 4 statements (BEGIN, set_config, the statement, COMMIT), so one inside
 * a loop or a `Promise.all` multiplies a request's cost. This scan reads all of `src` and lists:
 * - every call made on, or handed, a `ScopedClient` (never a transaction's client) inside a `for` / `while` / `do` body,
 *   an array callback (`map`, `forEach`, …) or the arguments of `Promise.all`, keyed `file#function: what is called`.
 *   A `$transaction` opened on a scoped client counts like a raw call (minor 742);
 * - minor 407: every call that hands a `ScopedClient` to a looping helper, keyed `file#helper←calling function`. A
 *   looping helper is a function with a client parameter (any type, union or `Pick` with `$queryRaw`, `$executeRaw` or
 *   `$transaction` among its members; minors 745, 774) that, inside a loop, runs `$queryRaw` / `$executeRaw` /
 *   `$transaction` on it or passes it to another function. Handing it a transaction's client is one transaction, so
 *   that is not flagged;
 * - minor 775: every call inside a loop that hands a `UserScopedDb` to an opener, keyed `file#calling function: opener`.
 *   An opener is a function whose own body (not a nested function's) runs a round on `.as(…)` / `.forAuthSub(…)` of
 *   that parameter, or of `toScoped(parameter)`, directly or through one `const`.
 * Each one is either moved into one transaction or listed below with its bound and reason.
 *
 * Limits: a call through a closure defined outside the loop is not seen (the scan reads where the call is written), and
 * helpers are followed one level only: a helper that hands its client, outside any loop, to a second helper that loops
 * is not seen. A looping method called through an interface-typed repository object is not resolved to its
 * implementation (minor 745). The known instance of the closure limit (minor 772) is `importBatch`
 * (`src/repositories/hevy-import.prisma.ts`): its loop calls `writeImportedWorkout(userId, …)`, which opens one scoped
 * transaction per workout through the repository's own handle, bounded at 25 workouts per batch by the route.
 */

const ARRAY_CALLBACKS = new Set(["map", "forEach", "flatMap", "filter", "reduce", "some", "every"]);
/** Minor 742: on a scoped client, a `$transaction` is a round of BEGIN … COMMIT as well. */
const SCOPED_ROUND = /^\$(queryRaw|executeRaw|transaction)$/;

/** `file#enclosing function: what is called`, or `file#helper←calling function` → why it may stay. */
const ALLOWED: Record<string, string> = {
  "src/repositories/exercise.prisma.ts#updateExercise: loadVisibleRow":
    "the guarded UPDATE's bounded retry (≤ 2 rounds, Spec 03.4 minor 225; the UPDATE itself is the `write` closure, unseen here): re-reads why it matched nothing, only on a miss (a race or a type lock)",
  "src/repositories/exercise.prisma.ts#updateExercise: lineageHasSets":
    "the same bounded retry, only for a guarded type change that missed (≤ 2)",
  "src/repositories/hevy-import.prisma.ts#importBatch: findCandidates":
    "one duplicate-candidate read per workout of a batch (≤ 25 workouts × ≤ 2 attempts); it sits between the per-workout write transactions and also serves the dry run, which opens none",
  "src/records/rebuild.ts#rebuildRecords: $transaction":
    "records:rebuild, an operator command on the owner login: one transaction per user on purpose (Spec 07.0 §6.5, D11), so each user's records lock is short and memory stays bounded; on the owner login as() sends no setting",
  "src/account/purge.ts#runPurge: purgeAccount":
    "account:purge, an operator command on the owner login: one transaction per account on purpose (Spec 11 §6.4; D11 rolls back one account and goes on), bounded by the accounts past their grace; on the owner login as() sends no setting",
};

interface Finding {
  key: string;
  line: number;
}

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFunctionLike = (node: ts.Node): node is FunctionLike =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

function scan(program: ts.Program, files: readonly string[]): Finding[] {
  const checker = program.getTypeChecker();
  const typeName = (node: ts.Node) => {
    const t = checker.getTypeAtLocation(node);
    return (t.aliasSymbol ?? t.getSymbol())?.getName();
  };
  const isScoped = (node: ts.Node) => typeName(node) === "ScopedClient";
  /**
   * Minor 745: a client parameter is known by its members (any union member has `$queryRaw`, `$executeRaw` or, minor 774,
   * `$transaction`), not its type's name.
   */
  const isClientParam = (node: ts.Node) => {
    const t = checker.getTypeAtLocation(node);
    return (t.isUnion() ? t.types : [t]).some((m) => {
      const apparent = checker.getApparentType(m);
      return ["$queryRaw", "$executeRaw", "$transaction"].some((name) => apparent.getProperty(name) !== undefined);
    });
  };
  /** Minor 775: the handle itself (`UserScopedDb` from `src/db/scoped.ts`, alone or in a union), not a client. */
  const isUserScopedDb = (node: ts.Node) => {
    const t = checker.getTypeAtLocation(node);
    return (t.isUnion() ? t.types : [t]).some((m) => {
      const sym = m.aliasSymbol ?? m.getSymbol();
      return sym?.getName() === "UserScopedDb" && (sym.declarations ?? []).some((d) => d.getSourceFile().fileName.endsWith("/src/db/scoped.ts"));
    });
  };
  const findings: Finding[] = [];
  const resolved = (sym: ts.Symbol | undefined) => (sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);

  // Minor 407, pass 1: the looping helpers, each with the positions of the client parameters it loops over.
  const helpers = new Map<ts.Symbol, { name: string; params: number[] }>();
  for (const file of files) {
    const findHelpers = (node: ts.Node) => {
      if (isFunctionLike(node) && node.body) {
        const nameNode = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ? node.name : ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) ? node.parent.name : undefined;
        const fn = nameNode && checker.getSymbolAtLocation(nameNode);
        const params = node.parameters.flatMap((param, i) => {
          if (!ts.isIdentifier(param.name) || !isClientParam(param.name)) return [];
          const paramSymbol = checker.getSymbolAtLocation(param.name);
          let loops = false;
          const walk = (n: ts.Node) => {
            if (loops) return;
            const callee = ts.isCallExpression(n) ? n.expression : ts.isTaggedTemplateExpression(n) ? n.tag : undefined;
            const runsOnIt = callee !== undefined && ts.isPropertyAccessExpression(callee) && SCOPED_ROUND.test(callee.name.text) && checker.getSymbolAtLocation(callee.expression) === paramSymbol;
            // ...or the loop hands the client on: `for (const r of rows) await insertOne(c, r)` is a round per row too.
            const handsItOn = ts.isCallExpression(n) && n.arguments.some((a) => ts.isIdentifier(a) && checker.getSymbolAtLocation(a) === paramSymbol);
            if ((runsOnIt || handsItOn) && inLoop(n, node)) loops = true;
            ts.forEachChild(n, walk);
          };
          walk(node.body!);
          return loops ? [i] : [];
        });
        if (fn && nameNode && params.length > 0) helpers.set(fn, { name: nameNode.getText(), params });
      }
      ts.forEachChild(node, findHelpers);
    };
    findHelpers(program.getSourceFile(file)!);
  }

  // Minor 775: the openers, each with the positions of the `UserScopedDb` parameters it opens a round on in its own body.
  const openers = new Map<ts.Symbol, { name: string; params: number[] }>();
  /** `p.as(…)` / `p.forAuthSub(…)` or the same on `toScoped(p)`, directly or through one `const` binding. */
  const opensOn = (receiver: ts.Expression, paramSymbol: ts.Symbol | undefined): boolean => {
    let r = receiver;
    if (ts.isIdentifier(r)) {
      const decl = checker.getSymbolAtLocation(r)?.valueDeclaration;
      const isConst = decl !== undefined && ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent) && (decl.parent.flags & ts.NodeFlags.Const) !== 0;
      if (!isConst || !decl.initializer) return false;
      r = decl.initializer;
    }
    if (!ts.isCallExpression(r) || !ts.isPropertyAccessExpression(r.expression) || !["as", "forAuthSub"].includes(r.expression.name.text)) return false;
    let target = r.expression.expression;
    if (ts.isCallExpression(target) && ts.isIdentifier(target.expression) && target.expression.text === "toScoped" && target.arguments.length === 1) target = target.arguments[0]!;
    return ts.isIdentifier(target) && checker.getSymbolAtLocation(target) === paramSymbol;
  };
  for (const file of files) {
    const findOpeners = (node: ts.Node) => {
      if (isFunctionLike(node) && node.body) {
        const nameNode = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ? node.name : ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) ? node.parent.name : undefined;
        const fn = nameNode && checker.getSymbolAtLocation(nameNode);
        const params = node.parameters.flatMap((param, i) => {
          if (!ts.isIdentifier(param.name) || !isUserScopedDb(param.name)) return [];
          const paramSymbol = checker.getSymbolAtLocation(param.name);
          let opens = false;
          // Its own body only: a round inside a nested function (a repository factory's methods) is not this call's.
          const walk = (n: ts.Node) => {
            if (opens || isFunctionLike(n)) return;
            const callee = ts.isCallExpression(n) ? n.expression : ts.isTaggedTemplateExpression(n) ? n.tag : undefined;
            if (callee !== undefined && ts.isPropertyAccessExpression(callee) && SCOPED_ROUND.test(callee.name.text) && opensOn(callee.expression, paramSymbol)) opens = true;
            ts.forEachChild(n, walk);
          };
          ts.forEachChild(node.body!, walk);
          return opens ? [i] : [];
        });
        if (fn && nameNode && params.length > 0) openers.set(fn, { name: nameNode.getText(), params });
      }
      ts.forEachChild(node, findOpeners);
    };
    findOpeners(program.getSourceFile(file)!);
  }

  for (const file of files) {
    const sf = program.getSourceFile(file)!;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        // Pass 2: a looping helper handed a scoped client runs 4 statements a round, wherever the call is written.
        const calleeName = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
        const helper = helpers.get(resolved(checker.getSymbolAtLocation(calleeName))!);
        if (helper?.params.some((i) => node.arguments[i] !== undefined && isScoped(node.arguments[i]!))) {
          findings.push({ key: `${rel(file)}#${helper.name}←${enclosingName(node)}`, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
        }
        // Minor 775: an opener handed the handle opens a round per call, so a call in a loop is one round per iteration.
        const opener = openers.get(resolved(checker.getSymbolAtLocation(calleeName))!);
        if (opener?.params.some((i) => node.arguments[i] !== undefined && isUserScopedDb(node.arguments[i]!)) && inLoop(node)) {
          findings.push({ key: `${rel(file)}#${enclosingName(node)}: ${calleeName.getText(sf)}`, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
        }
      }
      if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) {
        const callee = ts.isCallExpression(node) ? node.expression : node.tag;
        const args = ts.isCallExpression(node) ? [...node.arguments] : [];
        const onScoped = ts.isPropertyAccessExpression(callee) && SCOPED_ROUND.test(callee.name.text) && isScoped(callee.expression);
        const handedScoped = args.some((a) => isScoped(a));
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        if ((onScoped || handedScoped) && inLoop(node)) {
          const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(sf);
          findings.push({ key: `${rel(file)}#${enclosingName(node)}: ${name}`, line });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

/** Inside a loop body, an array callback, or `Promise.all(...)`'s arguments (looking no further out than `stop`). */
function inLoop(node: ts.Node, stop?: ts.Node): boolean {
  let child: ts.Node = node;
  for (let p = node.parent; p && child !== stop; child = p, p = p.parent) {
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
  const findings = scan(srcProgram(), srcFiles());

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

describe("minor 407 — a looping helper called with a scoped client", () => {
  const FIXTURE = "src/repositories/loop-fixture.ts";
  const HEAD = `import type { Prisma } from "@prisma/client";
import type { RawClient, UserScopedDb } from "../db/scoped.js";
declare const db: UserScopedDb;
declare const u: string;
declare const ids: string[];
async function each(c: RawClient, list: string[]) {
  for (const id of list) await c.$executeRaw\`SELECT \${id}\`;
}
const mapped = (list: string[], c: RawClient) => Promise.all(list.map((id) => c.$queryRaw\`SELECT \${id}\`));
async function once(c: RawClient, id: string) {
  await c.$executeRaw\`SELECT \${id}\`;
}
async function viaOnce(c: RawClient, list: string[]) {
  for (const id of list) await once(c, id);
}
async function eachU(c: RawClient | Prisma.TransactionClient, list: string[]) {
  for (const id of list) await c.$executeRaw\`SELECT \${id}\`;
}
async function eachP(c: Pick<Prisma.TransactionClient, "$executeRaw">, list: string[]) {
  for (const id of list) await c.$executeRaw\`SELECT \${id}\`;
}
void each; void mapped; void once; void viaOnce; void eachU; void eachP;
export type Tx = Prisma.TransactionClient;
`;
  const keysFor = (body: string) => scan(apiProgram([], { [FIXTURE]: HEAD + body }), [overlayPath(FIXTURE)]).map((f) => f.key);

  it("a helper that loops over its client is flagged where it is handed a scoped client", () => {
    expect(keysFor("export async function run() {\n  await each(db.as(u), ids);\n}\n")).toEqual([`${FIXTURE}#each←run`]);
  });

  it("a helper that loops in an array callback, with the client as a later parameter, is flagged too", () => {
    expect(keysFor("export async function run() {\n  const c = db.forAuthSub(u);\n  await mapped(ids, c);\n}\n")).toEqual([`${FIXTURE}#mapped←run`]);
  });

  it("the same helper handed a transaction's client is one transaction, and passes (Review Focus 2)", () => {
    expect(keysFor("export async function run() {\n  await db.as(u).$transaction((tx) => each(tx, ids));\n}\n")).toEqual([]);
  });

  it("a helper whose loop hands its client to another function is flagged too (final review)", () => {
    expect(keysFor("export async function run() {\n  await viaOnce(db.as(u), ids);\n}\n")).toEqual([`${FIXTURE}#viaOnce←run`]);
    expect(keysFor("export async function run() {\n  await db.as(u).$transaction((tx) => viaOnce(tx, ids));\n}\n")).toEqual([]);
  });

  it("minor 742 — a scoped $transaction per round is flagged", () => {
    expect(keysFor("export async function run() {\n  for (const id of ids) await db.as(u).$transaction(async (tx) => tx.$executeRaw`SELECT ${id}`);\n}\n")).toEqual([
      `${FIXTURE}#run: $transaction`,
    ]);
  });

  it("minor 745 — a helper whose client parameter is a union or a Pick is found", () => {
    expect(keysFor("export async function run() {\n  await eachU(db.as(u), ids);\n  await eachP(db.as(u), ids);\n}\n")).toEqual([
      `${FIXTURE}#eachU←run`,
      `${FIXTURE}#eachP←run`,
    ]);
  });

  it("a helper that doesn't loop is not flagged for a scoped client", () => {
    expect(keysFor('export async function run() {\n  await once(db.as(u), "a");\n}\n')).toEqual([]);
  });

  it("minor 774: a helper that loops $transaction on a handed client is a looping helper", () => {
    const body = `import type { ScopedClient } from "../db/scoped.js";
async function eachT(c: Pick<ScopedClient, "$transaction" | "$queryRaw">, list: string[]) {
  for (const id of list) await c.$transaction(async (tx) => tx.$executeRaw\`SELECT \${id}\`);
}
async function eachTx(c: Pick<ScopedClient, "$transaction">, list: string[]) {
  for (const id of list) await c.$transaction(async (tx) => tx.$executeRaw\`SELECT \${id}\`);
}
export async function run() {
  await eachT(db.as(u), ids);
  await eachTx(db.as(u), ids);
}
`;
    expect(keysFor(body)).toEqual([`${FIXTURE}#eachT←run`, `${FIXTURE}#eachTx←run`]);
  });

  const OPENERS = `import { toScoped } from "../db/scoped.js";
async function openOne(d: UserScopedDb, id: string) {
  await d.as(id).$transaction(async (tx) => tx.$executeRaw\`SELECT \${id}\`);
}
async function openVia(d: UserScopedDb, id: string) {
  const c = toScoped(d).as(id);
  await c.$queryRaw\`SELECT \${id}\`;
}
function make(d: UserScopedDb) {
  return { read: (id: string) => d.as(id).$queryRaw\`SELECT \${id}\` };
}
void openVia; void make;
`;

  it("minor 775: an opener of a scoped round called in a loop is flagged", () => {
    const body = `${OPENERS}export async function run() {
  for (const id of ids) {
    await openOne(db, id);
    await openVia(db, id);
  }
}
`;
    expect(keysFor(body)).toEqual([`${FIXTURE}#run: openOne`, `${FIXTURE}#run: openVia`]);
  });

  it("minor 775: an opener called once, or a factory handed the handle in a loop, is not flagged", () => {
    expect(keysFor(`${OPENERS}export async function run() {\n  await openOne(db, "a");\n}\n`)).toEqual([]);
    expect(keysFor(`${OPENERS}export async function run() {\n  for (const id of ids) make(db).read(id);\n}\n`)).toEqual([]);
  });
});
