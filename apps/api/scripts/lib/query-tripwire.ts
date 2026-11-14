import ts from "typescript";
import { MODEL_DELEGATES, QUERY_TAGS, UNSAFE_CALLS, isModelCall, isPrismaMember } from "./query-extract.js";

/**
 * Minor 393 — the query audit's tripwire. `extractStatements` finds statements by syntax, so a statement spelled in a
 * way it doesn't list (a string-indexed or destructured raw method, a renamed `Prisma`, `Prisma.sql` passed around,
 * `$queryRawTyped`, a destructured table delegate, a computed `Prisma.join` separator) would run with no audit row.
 * This scan refuses those spellings by type, so a renamed client or namespace is caught as well. Each issue reads
 * `<file>:<line> rule <n>: <what> — write <accepted spelling> (<file>#<function>)`.
 *
 * A "client" is any receiver whose type (or a union member's) has a `$queryRaw` or `$executeRaw` member: the
 * `PrismaClient`, a transaction client, the scoped handle's `RawClient` / `ScopedClient`, and any alias of them.
 */

const RAW_METHODS = new Set([...QUERY_TAGS, ...UNSAFE_CALLS]);
const TYPED_SQL = "$queryRawTyped";
const NAMESPACE_MEMBERS = new Set(["sql", "raw", "join"]);

/**
 * The functions that may pass a raw method around, keyed `<file>#<function>`, each with its reason. Only the scoped
 * handle does: it forwards the caller's statement unchanged, and the audit lists that statement where it is written.
 */
export const TRIPWIRE_ALLOWED: Readonly<Record<string, string>> = {
  "src/db/scoped.ts#scopedClient":
    "The per-user handle wraps the caller's $queryRaw / $executeRaw arguments in its set_config transaction unchanged; the statement is audited at the call site.",
  "src/db/scoped.ts#unscopedClient":
    "The owner-login pass-through forwards the caller's $queryRaw / $executeRaw arguments unchanged; the statement is audited at the call site.",
};

/** The nearest enclosing named function (or method), else `(module)`. */
function enclosingFunction(node: ts.Node): string {
  for (let p = node.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
  }
  return "(module)";
}

export function rawSqlSpellingIssues(
  program: ts.Program,
  files: readonly string[],
  relPath: (abs: string) => string,
  allowed: Readonly<Record<string, string>> = TRIPWIRE_ALLOWED,
): string[] {
  const checker = program.getTypeChecker();
  const out: string[] = [];

  const isClient = (node: ts.Node): boolean => {
    const t = checker.getTypeAtLocation(node);
    return (t.isUnion() ? t.types : [t]).some((m) => {
      const apparent = checker.getApparentType(m);
      return apparent.getProperty("$queryRaw") !== undefined || apparent.getProperty("$executeRaw") !== undefined;
    });
  };

  /** The `Prisma` namespace of `@prisma/client`, reached through any import or variable alias. */
  const isPrismaNamespace = (node: ts.Node): boolean => {
    const sym = checker.getTypeAtLocation(node).getSymbol();
    if (sym?.getName() !== "Prisma") return false;
    return (sym.getDeclarations() ?? []).some((d) => /[\\/]\.?prisma[\\/]client[\\/]/.test(d.getSourceFile().fileName));
  };

  const inTypePosition = (node: ts.Node): boolean => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
      if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
    }
    return false;
  };

  const isTag = (node: ts.Node) => ts.isTaggedTemplateExpression(node.parent) && node.parent.tag === node;
  const isCallee = (node: ts.Node) => ts.isCallExpression(node.parent) && node.parent.expression === node;

  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const report = (node: ts.Node, rule: number, what: string, accepted: string): true => {
      const key = `${relPath(file)}#${enclosingFunction(node)}`;
      if (allowed[key] === undefined) {
        out.push(`${relPath(file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} rule ${rule}: ${what} — write ${accepted} (${key})`);
      }
      return true;
    };

    /** A name read off `receiver`, by `.name`, `["name"]` or a destructuring, checked against the four rules. */
    const check = (node: ts.Node, receiver: ts.Node, name: string, form: "property" | "index" | "binding"): boolean => {
      if (name === TYPED_SQL && isClient(receiver)) return report(node, 2, "$queryRawTyped isn't listed by the query audit", "tx.$queryRaw`…`");
      if (RAW_METHODS.has(name) && isClient(receiver)) {
        if (form === "property" && (isTag(node) || isCallee(node))) return false;
        return report(node, 1, `${name} ${form === "binding" ? "destructured from" : "indexed on"} a client, or passed around`, `tx.${name}\`…\` or tx.${name}(…)`);
      }
      if (NAMESPACE_MEMBERS.has(name) && isPrismaNamespace(receiver)) {
        if (form === "property" && isPrismaMember(node as ts.Expression, name)) {
          if (name === "sql" && isTag(node)) return false;
          if (name === "raw" && isCallee(node)) return false;
          if (name === "join" && isCallee(node)) {
            const separator = (node.parent as ts.CallExpression).arguments[1];
            if (separator === undefined || ts.isStringLiteral(separator) || ts.isNoSubstitutionTemplateLiteral(separator)) return false;
            return report(node, 3, "a Prisma.join separator that isn't a string literal (it is raw SQL text)", 'Prisma.join(values, ", ")');
          }
        }
        return report(node, 3, `Prisma.${name} used other than as Prisma.sql\`…\`, Prisma.raw(…) or Prisma.join(…)`, `Prisma.${name === "sql" ? "sql`…`" : `${name}(…)`} spelled with Prisma`);
      }
      if (MODEL_DELEGATES.has(name) && isClient(receiver)) {
        const call = node.parent?.parent;
        if (form === "property" && ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && call && ts.isCallExpression(call) && call.expression === node.parent && isModelCall(call)) return false;
        return report(node, 4, `the ${name} delegate taken off a client`, `tx.${name}.findMany(…)`);
      }
      return false;
    };

    /** The string literals a computed key's type can hold (`m: "$queryRaw" | "$executeRaw"` → both). */
    const literalKeys = (key: ts.Expression): string[] => {
      const t = checker.getTypeAtLocation(key);
      return (t.isUnion() ? t.types : [t]).filter((m) => m.isStringLiteral()).map((m) => (m as ts.StringLiteralType).value);
    };

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && !inTypePosition(node)) {
        check(node, node.expression, node.name.text, "property");
      } else if (ts.isElementAccessExpression(node) && !inTypePosition(node)) {
        // One issue per access: a computed key stops at the first name it could hold that breaks a rule.
        const keys = ts.isStringLiteralLike(node.argumentExpression) ? [node.argumentExpression.text] : literalKeys(node.argumentExpression);
        keys.some((k) => check(node, node.expression, k, "index"));
      } else if (ts.isObjectBindingPattern(node)) {
        for (const el of node.elements) {
          const key = el.propertyName ?? el.name;
          if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) check(el, node, key.text, "binding");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}
