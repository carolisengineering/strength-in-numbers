// apps/api/test/unit/scoped-db-guards.test.ts
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MODEL_DELEGATES } from "../../scripts/lib/query-extract.js";
import { API_ROOT as API, apiProgram, overlayPath, rel as relPath, srcFiles, srcProgram } from "./helpers/ts-program.js";

/**
 * Spec 21.1 AC14, AC16, AC20 — the static guards that keep "who is asking" on every statement:
 * - AC14: nothing in `src` runs a statement on a bare `PrismaClient`, outside the files `BARE_CLIENT_ALLOWED` lists
 *   with their reasons (minor 406 widened it from four folders' raw SQL to all of `src` and any member);
 * - AC16: `shared()` is called only for the shared reference reads (and the operator scripts' cross-user listings);
 * - AC20: the composition root hands every repository factory the scoped handle, never the bare client.
 * A type-aware scan (the TypeScript checker), so a renamed variable cannot hide a bare client.
 */

const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function enclosingName(node: ts.Node): string {
  for (let p = node.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText();
  }
  return "(module)";
}

/**
 * AC14 (minor 406): the files that may use a bare client, each with its reason. Anything else in `src` that touches a
 * `PrismaClient` beyond `$connect` / `$disconnect` / `$metrics` / `$on` (which run no statement) fails.
 */
export const BARE_CLIENT_ALLOWED: Readonly<Record<string, string>> = {
  "src/db.ts": "The readiness probe and the pool metrics: no user's data, run before any request.",
  "src/db/scoped.ts": "The per-user handle itself: it opens the transaction that carries the acting user's setting.",
  "src/db/rls.ts": "The db:rls kill switch, an operator command on the owner login.",
  "src/db/app-role.ts": "db:app-role, an operator command on the owner login that gives sin_app its login.",
  "src/db/login-check.ts":
    "The boot check that the API's login can't bypass row-level security (Spec 21.1 Phase C): it reads pg_roles and the row_security setting before listen, no user's data (minor 777 sees its `Pick<PrismaClient, \"$queryRaw\">` alias).",
  "src/seed/catalog.ts": "The catalog seed, a release step on the owner login; it writes only the shared catalog.",
};

const NO_STATEMENT = new Set(["$connect", "$disconnect", "$metrics", "$on"]);

/**
 * The scoped handle's own types: they run statements with the acting user's setting, so they are never "bare". Minor
 * 738: excused only when declared in `src/db/scoped.ts`, so a `type RawClient = PrismaClient` elsewhere is still bare.
 */
const SCOPED_TYPES = new Set(["ScopedClient", "UserScopedDb", "RawClient"]);
const SCOPED_FILE = /[\\/]src[\\/]db[\\/]scoped\.ts$/;
const PRISMA_CLIENT_FILE = /[\\/]\.?prisma[\\/]client[\\/]/;
const declaredIn = (sym: ts.Symbol | undefined, file: RegExp) => (sym?.getDeclarations() ?? []).some((d) => file.test(d.getSourceFile().fileName));
const UTILITY_NARROWS = new Set(["Pick", "Omit"]);
/** Prisma 6's `ITXClientDenyList` (`@prisma/client/runtime/library.d.ts`): what a transaction client lacks. */
const ITX_DENY_LIST = ["$connect", "$disconnect", "$on", "$transaction", "$extends"];

/**
 * AC14: each property access on a bare client (any union member), as `file:line text`. A union member is bare when:
 * - (minor 567) it has `$transaction` plus at least one model delegate, so an intersection (`PrismaClient & {…}`) or an
 *   `$extends` client is one too, unless it is one of the scoped handle's types declared in `src/db/scoped.ts`
 *   (minor 738);
 * - (minor 741) it has a member typed as a Prisma model `*Delegate`, no `$transaction`, and isn't a transaction client
 *   (`Prisma.TransactionClient`, or the `Omit<PrismaClient, ITXClientDenyList>` Prisma hands a `$transaction` callback),
 *   so `Pick<PrismaClient, "workout">` and an alias of it are bare.
 * A `Pick<X, …>` / `Omit<X, …>`, inline or behind a local alias (minor 777), is judged by `X`:
 * `Pick<Prisma.TransactionClient, "workout">` is the same type as `Pick<PrismaClient, "workout">` structurally, and only
 * the type it narrows tells them apart.
 */
export function bareClientUses(p: ts.Program, files: readonly string[]): string[] {
  const checker = p.getTypeChecker();
  const out: string[] = [];
  const isDelegateType = (t: ts.Type) =>
    (t.isUnion() ? t.types : [t]).some((m) => {
      const sym = m.aliasSymbol ?? m.getSymbol();
      return sym !== undefined && sym.getName().endsWith("Delegate") && declaredIn(sym, PRISMA_CLIENT_FILE);
    });
  // Prisma's transaction client is `Omit<PrismaClient, ITXClientDenyList>`: it drops all five of these. An `Omit` that
  // drops fewer (only `$transaction`, say) is a hand-narrowed bare client (final review).
  const omitsDenyList = (keys: ts.Type | undefined) => {
    if (keys === undefined) return false;
    const omitted = new Set((keys.isUnion() ? keys.types : [keys]).flatMap((k) => (k.isStringLiteral() ? [k.value] : [])));
    return ITX_DENY_LIST.every((k) => omitted.has(k));
  };
  /**
   * A `Pick` / `Omit` and its type arguments: written inline (`aliasSymbol` is the utility itself), or (minor 777) behind
   * a local alias whose declaration is one (`type TxWorkout = Pick<Prisma.TransactionClient, "workout">`).
   */
  const utilityOf = (x: ts.Type): { name: string; args: readonly ts.Type[] } | undefined => {
    const alias = x.aliasSymbol;
    if (alias === undefined) return undefined;
    if (UTILITY_NARROWS.has(alias.getName())) return { name: alias.getName(), args: x.aliasTypeArguments ?? [] };
    const decl = alias.getDeclarations()?.find(ts.isTypeAliasDeclaration);
    if (decl === undefined || !ts.isTypeReferenceNode(decl.type) || !ts.isIdentifier(decl.type.typeName) || !UTILITY_NARROWS.has(decl.type.typeName.text)) return undefined;
    return { name: decl.type.typeName.text, args: (decl.type.typeArguments ?? []).map((a) => checker.getTypeFromTypeNode(a)) };
  };
  const isTransactionClient = (x: ts.Type) => {
    if (x.aliasSymbol?.getName() === "TransactionClient" && declaredIn(x.aliasSymbol, PRISMA_CLIENT_FILE)) return true;
    const utility = utilityOf(x);
    return utility?.name === "Omit" && omitsDenyList(utility.args[1]);
  };
  const bareType = (x: ts.Type, depth = 0): boolean => {
    const name = (x.aliasSymbol ?? x.getSymbol())?.getName();
    if (name !== undefined && SCOPED_TYPES.has(name) && declaredIn(x.aliasSymbol ?? x.getSymbol(), SCOPED_FILE)) return false;
    if (isTransactionClient(x)) return false;
    const narrowed = utilityOf(x)?.args[0];
    if (narrowed !== undefined && depth < 4) return bareType(narrowed, depth + 1);
    const apparent = checker.getApparentType(x);
    const props = apparent.getProperties();
    if (apparent.getProperty("$transaction") !== undefined) return props.some((m) => MODEL_DELEGATES.has(m.getName()));
    return props.some((m) => MODEL_DELEGATES.has(m.getName()) && isDelegateType(checker.getTypeOfSymbol(m)));
  };
  for (const file of files) {
    const sf = p.getSourceFile(file)!;
    const bare = (receiver: ts.Node) => {
      const t = checker.getTypeAtLocation(receiver);
      return (t.isUnion() ? t.types : [t]).some((x) => bareType(x));
    };
    const flag = (node: ts.Node) => out.push(`${relPath(file)}:${lineOf(sf, node)} ${node.getText(sf).slice(0, 60)}`);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && !NO_STATEMENT.has(node.name.text) && bare(node.expression)) flag(node);
      // `p["$transaction"]` and `const { $transaction: t } = p` reach the bare client too (code review #3).
      if (ts.isElementAccessExpression(node) && !(ts.isStringLiteralLike(node.argumentExpression) && NO_STATEMENT.has(node.argumentExpression.text)) && bare(node.expression)) flag(node);
      if (ts.isObjectBindingPattern(node) && bare(node)) {
        for (const el of node.elements) {
          const key = el.propertyName ?? el.name;
          if (!((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && NO_STATEMENT.has(key.text))) flag(el);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** AC16's files: all of `src`, recursively, as AC14 reads it (minor 569; it used to be six folders' top level). */
const ac16Files = (): string[] => srcFiles();

/**
 * AC16: every `.<name>()` call outside the handle itself, as `file#enclosing function`. `overlay` adds in-memory files
 * (absolute path → text) to the scan, for the tests of the scan itself.
 */
function callSitesOf(name: "shared" | "crossUserMaintenance", overlay: Readonly<Record<string, string>> = {}): string[] {
  const out = new Set<string>();
  for (const file of [...ac16Files(), ...Object.keys(overlay)]) {
    const sf = ts.createSourceFile(file, overlay[file] ?? readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name && node.arguments.length === 0) {
        out.add(`${relPath(file)}#${enclosingName(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...out].sort();
}

describe("Spec 21.1 AC14 / minor 406 — no statement on a bare PrismaClient anywhere in src", () => {
  const fixture = "src/repositories/x/fixture.ts";
  const usesIn = (source: string) => bareClientUses(apiProgram([], { [fixture]: source }), [overlayPath(fixture)]);
  const head = 'import { PrismaClient } from "@prisma/client";\n';

  it("all of src, recursively, uses a bare client only in the allowed files", () => {
    const files = srcFiles();
    expect(bareClientUses(srcProgram(), files).filter((u) => BARE_CLIENT_ALLOWED[u.slice(0, u.indexOf(":"))] === undefined)).toEqual([]);
  });

  it("every allowed file still uses a bare client (the map can't go stale)", () => {
    const files = srcFiles();
    const uses = bareClientUses(srcProgram(), files);
    for (const f of Object.keys(BARE_CLIENT_ALLOWED)) expect([f, uses.some((u) => u.startsWith(`${f}:`))]).toEqual([f, true]);
  });

  it("a model call on a bare client in a nested folder is flagged", () => {
    const uses = usesIn(`${head}export const f = (p: PrismaClient) => p.user.update({ where: { id: "1" }, data: {} });\n`);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/^src\/repositories\/x\/fixture\.ts:2 p\.user/);
  });

  it("$connect, $disconnect, $metrics and $on are not statements", () => {
    const uses = usesIn(
      `${head}export async function f(p: PrismaClient) {\n  await p.$connect();\n  await p.$disconnect();\n  void p.$metrics;\n  void p.$on;\n}\n`,
    );
    expect(uses).toEqual([]);
  });

  it("a bare client's member destructured or indexed is flagged too (code review #3)", () => {
    expect(usesIn(`${head}export const f = (p: PrismaClient) => {\n  const { $transaction: t } = p;\n  return t;\n};\n`)).toHaveLength(1);
    expect(usesIn(`${head}export const f = (p: PrismaClient) => p["$transaction"];\n`)).toHaveLength(1);
    expect(usesIn(`${head}export const f = async (p: PrismaClient) => {\n  const { $disconnect } = p;\n  await $disconnect();\n};\n`)).toEqual([]);
  });

  it("21.1 AC14 — minor 567: a bare client is known by its members, whatever its type is called", () => {
    const intersection = usesIn(`${head}declare const c: PrismaClient & { extra: 1 };\nexport const a = c.workout.findMany();\n`);
    expect(intersection).toHaveLength(1);
    expect(intersection[0]).toMatch(/^src\/repositories\/x\/fixture\.ts:3 c\.workout/);
    const extended = usesIn(`${head}const x = new PrismaClient().$extends({});\nexport const b = x.workout.findMany();\n`);
    expect(extended.some((u) => u.includes(":3 x.workout"))).toBe(true);
  });

  it("21.1 AC14 — minor 567: the scoped handle's own types are not bare clients", () => {
    const uses = usesIn(
      `import type { RawClient, ScopedClient, UserScopedDb } from "../../db/scoped.js";\nexport async function f(db: UserScopedDb, c: ScopedClient, r: RawClient) {\n  await db.as("u").$queryRaw\`SELECT 1\`;\n  await c.$transaction(async (tx) => tx.$queryRaw\`SELECT 1\`);\n  await r.$executeRaw\`SELECT 1\`;\n}\n`,
    );
    expect(uses).toEqual([]);
  });

  it("21.1 AC14 — minor 741: a bare client narrowed to one model is bare", () => {
    const inline = usesIn(`${head}export const f = (p: Pick<PrismaClient, "workout">) => p.workout.findMany();\n`);
    expect(inline).toHaveLength(1);
    expect(inline[0]).toMatch(/:2 p\.workout/);
    expect(usesIn(`${head}type W = Pick<PrismaClient, "workout">;\nexport const g = (w: W) => w.workout.findMany();\n`)).toHaveLength(1);
  });

  it("21.1 AC14 — minor 741: a transaction client, whole or narrowed, is not bare", () => {
    expect(
      usesIn(
        'import type { Prisma } from "@prisma/client";\nexport const f = (t: Prisma.TransactionClient, n: Pick<Prisma.TransactionClient, "workout">) => Promise.all([t.workout.findMany(), n.workout.findMany()]);\n',
      ),
    ).toEqual([]);
  });

  it("21.1 AC14 — minor 741 (final review): an Omit that drops only $transaction is a narrowed bare client, not a transaction client", () => {
    const uses = usesIn(`${head}export const f = (p: Omit<PrismaClient, "$transaction">) => p.workout.findMany();\n`);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/:2 p\.workout/);
    // Prisma's own transaction-client shape drops its whole deny list, and stays not bare.
    expect(
      usesIn(`${head}export const g = (t: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">) => t.workout.findMany();\n`),
    ).toEqual([]);
  });

  it("minor 777: a named alias of a narrowed transaction client is not bare", () => {
    expect(
      usesIn(
        `${head}import type { Prisma } from "@prisma/client";\ntype TxWorkout = Pick<Prisma.TransactionClient, "workout">;\ntype TxAll = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;\nexport const f = (n: TxWorkout, t: TxAll) => Promise.all([n.workout.findMany(), t.workout.findMany()]);\n`,
      ),
    ).toEqual([]);
  });

  it("21.1 AC14 — minor 741: an object with a member named like a model is not a client", () => {
    expect(usesIn("declare const row: { user: { id: string }; workout: string };\nexport const a = [row.user.id, row.workout];\n")).toEqual([]);
  });

  it("21.1 AC14 — minor 738: a scoped type's name declared elsewhere doesn't excuse a bare client", () => {
    const uses = usesIn(`${head}type RawClient = PrismaClient;\ndeclare const r: RawClient;\nexport const a = r.workout.findMany();\n`);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/:4 r\.workout/);
  });

  it("a model call on the transaction client is not a bare use (Review Focus 5)", () => {
    const uses = usesIn(`${head}export const f = (p: PrismaClient) => p.$transaction(async (tx) => tx.user.findUnique({ where: { id: "1" } }));\n`);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain("p.$transaction");
  });

  it("the scan sees a bare client where there is one (src/db.ts's readiness probe)", () => {
    expect(bareClientUses(apiProgram([`${API}src/db.ts`]), [`${API}src/db.ts`]).some((s) => s.includes("$queryRaw"))).toBe(true);
  });
});

describe("Spec 21.1 AC16 — minor 404: shared() is only for the shared reference reads", () => {
  it("21.1 AC16 — minor 569: the shared() scan reads all of src, subfolders included", () => {
    expect(ac16Files()).toEqual(srcFiles());
    const nested = overlayPath("src/repositories/nested/x.ts");
    const sites = callSitesOf("shared", { [nested]: "declare const db: { shared(): unknown };\nexport function peek() {\n  return db.shared();\n}\n" });
    expect(sites).toContain("src/repositories/nested/x.ts#peek");
  });

  it("shared()'s call sites are exactly the exercise reference reads", () => {
    expect(callSitesOf("shared")).toEqual([
      "src/repositories/exercise.prisma.ts#listEquipment",
      "src/repositories/exercise.prisma.ts#listMuscleGroups",
      "src/repositories/exercise.prisma.ts#validateReferences",
    ]);
  });

  it("the operator scripts' cross-user listings use crossUserMaintenance(), and nothing else does", () => {
    expect(callSitesOf("crossUserMaintenance")).toEqual(["src/account/purge.ts#runPurge", "src/records/rebuild.ts#rebuildRecords"]);
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

  it("the bare client reaches only the boot check, the RLS warning, the readiness probe, the pool metrics, the handle and the shutdown", () => {
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
    expect([...new Set(uses)].sort()).toEqual(["assertLoginCannotBypassRls", "checkDatabaseReady", "createGracefulShutdown", "createScopedDb", "warnIfRlsDisabled", "wirePoolMetrics"]);
  });
});
