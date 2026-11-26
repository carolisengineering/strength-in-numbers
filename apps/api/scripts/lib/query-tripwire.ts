import ts from "typescript";
import { MODEL_DELEGATES, QUERY_TAGS, UNSAFE_CALLS, isModelCall, isPrismaMember } from "./query-extract.js";

/**
 * Minor 393 — the query audit's tripwire. `extractStatements` finds statements by syntax, so a statement spelled in a
 * way it doesn't list (a string-indexed or destructured raw method, a renamed `Prisma`, `Prisma.sql` passed around,
 * `$queryRawTyped`, a destructured table delegate, a computed `Prisma.join` separator, prefix or suffix, `new Prisma.Sql`,
 * the Prisma runtime's own `sqltag` / `raw`) would run with no audit row.
 * This scan refuses those spellings by type, so a renamed client or namespace is caught as well. Each issue reads
 * `<file>:<line> rule <n>: <what> — write <accepted spelling> (<file>#<function>)`.
 *
 * A "client" is any receiver whose type (or a union member's) has a `$queryRaw` or `$executeRaw` member: the
 * `PrismaClient`, a transaction client, the scoped handle's `RawClient` / `ScopedClient`, and any alias of them.
 *
 * Two rules don't ask what the receiver is, because a cast or a narrowed type hides it:
 * - a raw method's name (rules 1 and 2) read as a property, an index, a destructuring key (in a declaration, an
 *   assignment pattern, an array pattern or a `for…of` head) or a `Reflect.get` key (`Reflect.get` however reached:
 *   `Reflect["get"]`, destructured or copied; minor 732) is a hit on any receiver (minor 566); only the tagged
 *   `x.$queryRaw` template and the call `x.$queryRaw(…)` are accepted. A string that merely holds the name (a log
 *   message) is not an access. Rule 1's message says whether the method was read, indexed or destructured (minor 733);
 * - a member whose own type is a Prisma `*Delegate` (rule 4) is a hit whatever it was read off, so
 *   `Pick<Prisma.TransactionClient, "workout">` doesn't hide a model call (minor 565). In an assignment pattern the
 *   member's type on the receiver decides, since the target is often `unknown` (minor 732). `tx.workout.fields`,
 *   Prisma's field references, run no statement and pass (minor 568).
 */

const RAW_METHODS = new Set([...QUERY_TAGS, ...UNSAFE_CALLS]);
const TYPED_SQL = "$queryRawTyped";
/** `Sql` is the class behind `Prisma.raw`: `new Prisma.Sql([text], [])` is raw SQL, so it is never accepted. */
const NAMESPACE_MEMBERS = new Set(["sql", "raw", "join", "Sql"]);
/** The runtime module that exports `sqltag`, `raw`, `join` and `Sql` under their own names (final review I-2). */
const PRISMA_RUNTIME = /^@prisma\/client\/runtime(\/|$)/;

/**
 * The functions that may pass a raw method around (rule 1 only), keyed `<file>#<function>`, each with its reason. Only
 * the scoped handle does: it forwards the caller's statement unchanged, and the audit lists it where it is written.
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

  const PRISMA_CLIENT_FILE = /[\\/]\.?prisma[\\/]client[\\/]/;

  /** A type that is (or has a union member that is) one of the generated client's `*Delegate` types. */
  const isDelegateType = (t: ts.Type): boolean =>
    (t.isUnion() ? t.types : [t]).some((m) => {
      const sym = m.aliasSymbol ?? m.getSymbol();
      return sym !== undefined && sym.getName().endsWith("Delegate") && (sym.getDeclarations() ?? []).some((d) => PRISMA_CLIENT_FILE.test(d.getSourceFile().fileName));
    });

  /** Minor 565: the node's own type is a `*Delegate`. */
  const isDelegate = (node: ts.Node): boolean => isDelegateType(checker.getTypeAtLocation(node));

  /**
   * Minor 732: the member `name` of the receiver's type (any union member) is a `*Delegate`. In `({ workout: w } = d)`
   * the target `w` is often `unknown`, so it is the member's type on `d` that tells.
   */
  const memberIsDelegate = (receiver: ts.Node, name: string): boolean => {
    const t = checker.getTypeAtLocation(receiver);
    return (t.isUnion() ? t.types : [t]).some((m) => {
      const prop = checker.getApparentType(m).getProperty(name);
      return prop !== undefined && isDelegateType(checker.getTypeOfSymbolAtLocation(prop, receiver));
    });
  };

  /** Minor 732: a callee whose type is `Reflect.get`, however it was reached (`Reflect["get"]`, destructured, copied). */
  const isReflectGet = (callee: ts.Expression): boolean => {
    const sym = checker.getTypeAtLocation(callee).getSymbol();
    if (sym?.getName() !== "get") return false;
    return (sym.getDeclarations() ?? []).some(
      (d) => ts.isFunctionDeclaration(d) && ts.isModuleBlock(d.parent) && ts.isModuleDeclaration(d.parent.parent) && d.parent.parent.name.text === "Reflect",
    );
  };

  /** The `Prisma` namespace of `@prisma/client`, reached through any import or variable alias. */
  const isPrismaNamespace = (node: ts.Node): boolean => {
    const sym = checker.getTypeAtLocation(node).getSymbol();
    if (sym?.getName() !== "Prisma") return false;
    return (sym.getDeclarations() ?? []).some((d) => PRISMA_CLIENT_FILE.test(d.getSourceFile().fileName));
  };

  const inTypePosition = (node: ts.Node): boolean => {
    for (let p = node.parent; p; p = p.parent) {
      // `tx.$queryRaw<Row[]>` saved as a value, and a class's `extends Prisma.Sql`, are expressions (code review #1); only
      // an `implements` clause (an interface's `extends` is caught below) makes one a type.
      if (ts.isExpressionWithTypeArguments(p)) {
        if (ts.isHeritageClause(p.parent) && p.parent.token === ts.SyntaxKind.ImplementsKeyword) return true;
        continue;
      }
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
      // An allowed pass-through is excused from rule 1 only: forwarding a raw method (code review #5).
      if (rule !== 1 || allowed[key] === undefined) {
        out.push(`${relPath(file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} rule ${rule}: ${what} — write ${accepted} (${key})`);
      }
      return true;
    };

    /**
     * A name read off `receiver`, by `.name`, `["name"]`, a destructuring or `Reflect.get`, checked against the four
     * rules. Rules 1 and 2 hold on any receiver (minor 566).
     */
    const check = (node: ts.Node, receiver: ts.Node, name: string, form: "property" | "index" | "binding"): boolean => {
      if (name === TYPED_SQL) return report(node, 2, "$queryRawTyped isn't listed by the query audit", "tx.$queryRaw`…`");
      if (RAW_METHODS.has(name)) {
        if (form === "property" && (isTag(node) || isCallee(node))) return false;
        // Minor 733: the message names what was done (a plain property read isn't an index).
        const what = { property: "read without being called", index: "indexed on a client", binding: "destructured from a client" }[form];
        return report(node, 1, `${name} ${what}, or passed around`, `tx.${name}\`…\` or tx.${name}(…)`);
      }
      if (NAMESPACE_MEMBERS.has(name) && isPrismaNamespace(receiver)) {
        if (form === "property" && isPrismaMember(node as ts.Expression, name)) {
          if (name === "sql" && isTag(node)) return false;
          if (name === "raw" && isCallee(node)) return false;
          if (name === "join" && isCallee(node)) {
            // The separator, prefix and suffix are raw SQL text (final review I-1).
            const rawArgs = (node.parent as ts.CallExpression).arguments.slice(1);
            if (rawArgs.every((a) => ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) return false;
            return report(node, 3, "a Prisma.join separator, prefix or suffix that isn't a string literal (it is raw SQL text)", 'Prisma.join(values, ", ")');
          }
        }
        if (name === "Sql" && ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && node.parent.right === node) return false;
        if (name === "Sql") return report(node, 3, "Prisma.Sql used as a value (new Prisma.Sql([text], []) is raw SQL)", "Prisma.sql`…`, or Prisma.raw(…) on UNSAFE_ALLOWLIST");
        return report(node, 3, `Prisma.${name} used other than as Prisma.sql\`…\`, Prisma.raw(…) or Prisma.join(…)`, `Prisma.${name === "sql" ? "sql`…`" : `${name}(…)`} spelled with Prisma`);
      }
      if (MODEL_DELEGATES.has(name) && (isClient(receiver) || isDelegate(node) || memberIsDelegate(receiver, name))) {
        const call = node.parent?.parent;
        const member = form === "property" && ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node ? node.parent : undefined;
        if (member && call && ts.isCallExpression(call) && call.expression === member && isModelCall(call)) return false;
        // Minor 568: `tx.workout.fields` (and anything under it) is a field reference, not a statement.
        if (member?.name.text === "fields") return false;
        return report(node, 4, "a model call or member isn't listed by the query audit", `tx.${name}.findMany(…)`);
      }
      return false;
    };

    /** The string literals a computed key's type can hold (`m: "$queryRaw" | "$executeRaw"` → both). */
    const literalKeys = (key: ts.Expression): string[] => {
      const t = checker.getTypeAtLocation(key);
      return (t.isUnion() ? t.types : [t]).filter((m) => m.isStringLiteral()).map((m) => (m as ts.StringLiteralType).value);
    };

    const unparenthesized = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unparenthesized(e.expression) : e);
    const isPattern = (e: ts.Expression): e is ts.ObjectLiteralExpression | ts.ArrayLiteralExpression =>
      ts.isObjectLiteralExpression(e) || ts.isArrayLiteralExpression(e);

    /**
     * Minor 566: `({ $queryRaw: q } = tx)`, an object literal used as an assignment pattern, nested ones included.
     * Minor 732: also an array literal (`[{ $queryRaw: q }] = [tx]`) and a `for…of` head. Each key is checked against
     * the receivers it could be read from (one issue per key): an array pattern's element against the receiver
     * array literal's matching element, else the receiver itself.
     */
    const checkPattern = (pattern: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, receivers: readonly ts.Node[]): void => {
      if (ts.isArrayLiteralExpression(pattern)) {
        pattern.elements.forEach((el, i) => {
          const inner = unparenthesized(el);
          if (!isPattern(inner)) return;
          checkPattern(inner, receivers.map((r) => (ts.isArrayLiteralExpression(r) ? (r.elements[i] ?? r) : r)));
        });
        return;
      }
      for (const prop of pattern.properties) {
        if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
        const key = prop.name;
        const keys = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? [key.text] : ts.isComputedPropertyName(key) ? (ts.isStringLiteralLike(key.expression) ? [key.expression.text] : literalKeys(key.expression)) : [];
        keys.some((k) => receivers.some((r) => check(prop, r, k, "binding")));
        if (ts.isPropertyAssignment(prop) && isPattern(unparenthesized(prop.initializer))) checkPattern(unparenthesized(prop.initializer) as ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, [prop]);
      }
    };

    /** Rule 5: the runtime module imported, re-exported or required directly, except as types only. */
    const runtimeSpecifier = (spec: ts.Expression | undefined) => spec !== undefined && ts.isStringLiteralLike(spec) && PRISMA_RUNTIME.test(spec.text);
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && runtimeSpecifier(node.moduleSpecifier)) {
        // `import type { … }`, or every named binding marked `type` (code review #6): erased, so it builds no SQL.
        const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
        const named = ts.isImportDeclaration(node) ? clause?.namedBindings : node.exportClause;
        const allTyped =
          named !== undefined && (ts.isNamedImports(named) || ts.isNamedExports(named)) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
        const typeOnly = ts.isImportDeclaration(node)
          ? clause?.isTypeOnly === true || (clause?.name === undefined && allTyped)
          : node.isTypeOnly || allTyped;
        if (!typeOnly) report(node, 5, "the Prisma runtime imported directly (its sqltag / raw / join / Sql build SQL the audit can't see)", 'import { Prisma } from "@prisma/client"');
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && runtimeSpecifier(node.arguments[0])) {
        report(node, 5, "the Prisma runtime loaded directly (its sqltag / raw / join / Sql build SQL the audit can't see)", 'import { Prisma } from "@prisma/client"');
      }
      if (ts.isPropertyAccessExpression(node) && !inTypePosition(node)) {
        check(node, node.expression, node.name.text, "property");
      } else if (ts.isElementAccessExpression(node) && !inTypePosition(node)) {
        // One issue per access: a computed key stops at the first name it could hold that breaks a rule.
        const keys = ts.isStringLiteralLike(node.argumentExpression) ? [node.argumentExpression.text] : literalKeys(node.argumentExpression);
        keys.some((k) => check(node, node.expression, k, "index"));
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isPattern(unparenthesized(node.left))) {
        checkPattern(unparenthesized(node.left) as ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, [node.right]);
      } else if (ts.isForOfStatement(node) && isPattern(unparenthesized(node.initializer as ts.Expression))) {
        // Minor 732: `for ({ $queryRaw: q } of [tx])` destructures each element of what it iterates.
        const iterated = unparenthesized(node.expression);
        const receivers = ts.isArrayLiteralExpression(iterated) && iterated.elements.length > 0 ? iterated.elements : [node.expression];
        checkPattern(unparenthesized(node.initializer as ts.Expression) as ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, receivers);
      } else if (ts.isCallExpression(node) && node.arguments.length >= 2 && isReflectGet(node.expression)) {
        // `Reflect.get(tx, "$queryRaw")` reads the member as an index does (minor 566), however `get` was reached (minor 732).
        const key = node.arguments[1]!;
        const keys = ts.isStringLiteralLike(key) ? [key.text] : literalKeys(key);
        keys.some((k) => check(node, node.arguments[0]!, k, "index"));
      } else if (ts.isObjectBindingPattern(node)) {
        for (const el of node.elements) {
          const key = el.propertyName ?? el.name;
          if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) check(el, node, key.text, "binding");
          else if (ts.isComputedPropertyName(key)) {
            // `{ ["$queryRaw"]: q }` or `{ [m]: q }` (code review #2).
            const keys = ts.isStringLiteralLike(key.expression) ? [key.expression.text] : literalKeys(key.expression);
            keys.some((k) => check(el, node, k, "binding"));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}
