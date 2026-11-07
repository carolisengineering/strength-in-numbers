import { createHash } from "node:crypto";
import ts from "typescript";

/**
 * Spec 21.0 §6.6, AC18–AC21 — the query audit's machinery. Every SQL statement in `apps/api/src` is found in
 * the TypeScript syntax tree (never by grep), given a stable key and a fingerprint of its text, and checked
 * against `docs/security/query-audit.md`. A statement added, removed or edited without the audit changing fails
 * the unit job; `pnpm --filter @sin/api run audit:queries --write` rewrites the fingerprints, keeps every
 * classification and marks the changed rows `needs review`, which also fails until a person sets the category.
 *
 * What counts as a statement:
 * - a tagged template whose tag is `$queryRaw` / `$executeRaw` on any client (a transaction, an aliased or a
 *   destructured one): a **query**;
 * - a `$queryRaw(…)` / `$executeRaw(…)` call (its argument is a `Prisma.sql` value): a **query**;
 * - a `Prisma.sql` template that isn't inside another statement: a **fragment**, listed with its callers;
 * - a `Prisma.raw(…)` call: a **fragment** too, and, like `$queryRawUnsafe` / `$executeRawUnsafe`, allowed only
 *   where `UNSAFE_ALLOWLIST` gives a reason.
 *
 * A template nested inside a statement (a `Prisma.sql` in a `${…}`) is part of that statement's text.
 */

export interface Source {
  /** Path relative to `apps/api`, e.g. `src/repositories/routine.prisma.ts`. */
  file: string;
  text: string;
}

export interface Extracted {
  key: string;
  file: string;
  fn: string;
  ordinal: number;
  kind: "query" | "fragment";
  /** The statement with whitespace collapsed; `${…}` spans keep their source. */
  text: string;
  fingerprint: string;
  /** Fragments only: the keys of the statements that use it. */
  callers: string[];
  /** Unsafe calls in this statement (`Prisma.raw`, `$queryRawUnsafe`, `$executeRawUnsafe`). */
  unsafe: string[];
}

export type Category =
  | "user-filtered"
  | "anchored"
  | "shared on purpose"
  | "cross-user maintenance"
  | "fragment"
  | "uncategorized";

export interface AuditRow {
  key: string;
  kind: "query" | "fragment";
  category: Category | string;
  status: "ok" | "needs review" | string;
  /** For `anchored`: the anchor's key. For fragments: `callers: …` (generated). Else `—`. */
  anchor: string;
  fingerprint: string;
  description: string;
}

/**
 * The unsafe raw-SQL call sites `apps/api/src` may have, keyed `<file>#<function>`, each with the reason its text
 * can't carry request input. Every one builds SQL from code constants (column lists, aliases, table names).
 */
export const UNSAFE_ALLOWLIST: Record<string, string> = {
  "src/repositories/exercise.prisma.ts#exerciseColumns":
    "Joins the constant EXERCISE_DB_COLUMNS list, optionally prefixed by a table alias every caller passes as a literal (`e`).",
  "src/repositories/planned-sets.ts#plannedSetsJson":
    "Table and column are literal-union parameters; the parent reference is a column literal at both call sites.",
  "src/repositories/section-timer-columns.ts#timedFieldsJson": "The section alias is the literal type `\"s\"`; the rest is constant text.",
  "src/repositories/section-timer-columns.ts#roundTimesJson": "The section reference is a column literal at every call site (`s.id`, `\"workout_section\".id`).",
  "src/repositories/workout-section.prisma.ts#SECTION_COLUMNS": "A constant column list plus roundTimesJson of a column literal.",
  "src/repositories/workout.prisma.ts#workoutSectionsJson": "The parent reference is a column literal at both call sites (`w.id`, `\"workout\".id`).",
  "src/repositories/workout.prisma.ts#routineIsOneOffSql": "The workout alias is the literal union `w` | `\"workout\"`.",
  "src/seed/catalog.ts#upsertReference": "The table name is the literal union `muscle_group` | `equipment`; every value stays a bound parameter.",
};

const QUERY_TAGS = new Set(["$queryRaw", "$executeRaw"]);
const UNSAFE_CALLS = new Set(["$queryRawUnsafe", "$executeRawUnsafe"]);
export const WRITE_COMMAND = "pnpm --filter @sin/api run audit:queries --write";

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** `x.$queryRaw`, a destructured `$queryRaw`, … → `$queryRaw`. */
function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return undefined;
}

const isPrismaMember = (expr: ts.Expression, member: string) =>
  ts.isPropertyAccessExpression(expr) && expr.name.text === member && ts.isIdentifier(expr.expression) && expr.expression.text === "Prisma";

/** A template's text with each `${…}` kept as its source. */
function templateText(t: ts.TemplateLiteral, sf: ts.SourceFile): string {
  if (ts.isNoSubstitutionTemplateLiteral(t)) return collapse(t.rawText ?? t.text);
  let out = t.head.rawText ?? t.head.text;
  for (const span of t.templateSpans) {
    out += "${" + span.expression.getText(sf) + "}" + (span.literal.rawText ?? span.literal.text);
  }
  return collapse(out);
}

function argText(arg: ts.Expression | undefined, sf: ts.SourceFile): string {
  if (!arg) return "";
  if (ts.isTaggedTemplateExpression(arg) && isPrismaMember(arg.tag, "sql")) return templateText(arg.template, sf);
  if (ts.isTemplateLiteral(arg)) return templateText(arg, sf);
  if (ts.isStringLiteral(arg)) return collapse(arg.text);
  return "${" + collapse(arg.getText(sf)) + "}";
}

const isTopLevel = (d: ts.VariableDeclaration) =>
  !!d.parent.parent && ts.isVariableStatement(d.parent.parent) && ts.isSourceFile(d.parent.parent.parent);

/** The name a statement is filed under: its innermost named function, method or module-level declaration. */
function enclosingName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      const p = n.parent;
      // A module-level `const f = () => …` names the statement; a local arrow (`const write = () => …`) files it
      // under the function it sits in, so the key stays stable and a local fragment finds its caller.
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && isTopLevel(p)) return p.name.text;
      if (ts.isPropertyAssignment(p)) return p.name.getText();
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isTopLevel(n)) return n.name.text;
  }
  return "<module>";
}

/**
 * A fragment's name for finding its callers: the variable it is assigned to (through any `.map(…)`-style callback
 * it is built in: `const values = items.map((it) => Prisma.sql\`…\`)`), else its function.
 */
function fragmentName(node: ts.Node): { name: string; local: boolean } {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return { name: n.name.text, local: !isTopLevel(n) };
    if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) break;
    // A callback passed to a call (`.map`, `.flatMap`) is walked through; an arrow assigned to a variable reaches it next.
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && !ts.isCallExpression(n.parent) && !ts.isVariableDeclaration(n.parent)) break;
  }
  return { name: enclosingName(node), local: false };
}

/** Unsafe calls anywhere under `node`. */
function unsafeIn(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      if (name && UNSAFE_CALLS.has(name)) found.push(name);
      if (isPrismaMember(n.expression, "raw")) found.push("Prisma.raw");
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

interface Pending extends Omit<Extracted, "key" | "ordinal" | "fingerprint" | "callers"> {
  name: { name: string; local: boolean } | null;
}

export function extractStatements(sources: readonly Source[]): Extracted[] {
  const pending: Pending[] = [];
  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      let found: { kind: "query" | "fragment"; text: string } | null = null;
      if (ts.isTaggedTemplateExpression(node)) {
        const name = calleeName(node.tag);
        if (name && QUERY_TAGS.has(name) && !isPrismaMember(node.tag, "sql")) found = { kind: "query", text: templateText(node.template, sf) };
        else if (isPrismaMember(node.tag, "sql")) found = { kind: "fragment", text: templateText(node.template, sf) };
      } else if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        if (name && (QUERY_TAGS.has(name) || UNSAFE_CALLS.has(name))) {
          found = { kind: "query", text: node.arguments.map((a) => argText(a, sf)).join(", ") };
        } else if (isPrismaMember(node.expression, "raw")) {
          found = { kind: "fragment", text: argText(node.arguments[0], sf) };
        }
      }
      if (found) {
        pending.push({
          file,
          fn: enclosingName(node),
          kind: found.kind,
          text: found.text,
          unsafe: unsafeIn(node),
          name: found.kind === "fragment" ? fragmentName(node) : null,
        });
        return; // A template nested inside a statement is part of its text.
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const ordinals = new Map<string, number>();
  const rows: Extracted[] = pending.map((p) => {
    const at = `${p.file}#${p.fn}`;
    const ordinal = (ordinals.get(at) ?? 0) + 1;
    ordinals.set(at, ordinal);
    return { ...p, key: `${at}#${ordinal}`, ordinal, fingerprint: fingerprint(p.text), callers: [] };
  });
  // Fragment callers: every other statement whose text names the fragment (a local one only within its function).
  pending.forEach((p, i) => {
    if (!p.name) return;
    const re = new RegExp(`(?<![\\w$])${p.name.name.replace(/[$]/g, "\\$")}(?![\\w$])`);
    rows[i]!.callers = rows
      .filter((r, j) => j !== i && re.test(r.text) && (!p.name!.local || (r.file === p.file && r.fn === p.fn)))
      .map((r) => r.key);
  });
  return rows.map(({ ...r }) => {
    delete (r as Partial<Pending>).name;
    return r;
  });
}

/** A `${…}` that composes SQL (a call, a nested template, a constant fragment) rather than binding a value. */
const COMPOSES = /\(|`|\bPrisma\.|\b[A-Z][A-Z0-9_]{2,}\b/;

/**
 * Whitespace collapsed; each value `${…}` becomes `?`, so renaming a bound variable changes nothing. A `${…}`
 * that composes SQL keeps its source: swapping `${ownedSet(…)}` for `${Prisma.empty}` must change the fingerprint.
 */
export function fingerprint(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "$" && text[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth += 1;
        else if (text[j] === "}") depth -= 1;
        j += 1;
      }
      const expr = text.slice(i + 2, j - 1);
      out += COMPOSES.test(expr) ? "${" + collapse(expr) + "}" : "?";
      i = j;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return createHash("sha256").update(collapse(out)).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------------------------------------------
// The audit document
// ---------------------------------------------------------------------------------------------------------------

const ROW_RE = /^\| `([^`]+)` \| (query|fragment) \| ([^|]+) \| ([^|]+) \| (.*?) \| `([0-9a-f]{12})` \| (.*) \|$/;

export function parseAudit(md: string): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const line of md.split("\n")) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    rows.push({
      key: m[1]!,
      kind: m[2] as AuditRow["kind"],
      category: m[3]!.trim(),
      status: m[4]!.trim(),
      anchor: m[5]!.trim(),
      fingerprint: m[6]!,
      description: m[7]!.trim().replace(/\\\|/g, "|"),
    });
  }
  return rows;
}

const fileOf = (key: string) => key.slice(0, key.indexOf("#"));
const fnOf = (key: string) => key.slice(key.indexOf("#") + 1, key.lastIndexOf("#"));

/** The rows `--write` produces: classifications kept, moved statements matched by fingerprint, changed ones `needs review`. */
export function reconcile(existing: readonly AuditRow[], extracted: readonly Extracted[]): AuditRow[] {
  const unused = new Set(existing);
  const take = (r: AuditRow | undefined) => {
    if (r) unused.delete(r);
    return r;
  };
  return extracted.map((s) => {
    const sameKey = existing.find((r) => r.key === s.key && unused.has(r));
    const exact = sameKey?.fingerprint === s.fingerprint ? take(sameKey) : undefined;
    const moved = exact ?? take(existing.find((r) => unused.has(r) && r.fingerprint === s.fingerprint && fileOf(r.key) === s.file && fnOf(r.key) === s.fn));
    const anchor = s.kind === "fragment" ? (s.callers.length > 0 ? `callers: ${s.callers.join(", ")}` : "callers: none") : undefined;
    if (moved) return { ...moved, key: s.key, kind: s.kind, fingerprint: s.fingerprint, anchor: anchor ?? moved.anchor };
    const changed = sameKey && unused.has(sameKey) ? take(sameKey) : undefined;
    if (changed) return { ...changed, kind: s.kind, fingerprint: s.fingerprint, status: "needs review", anchor: anchor ?? changed.anchor };
    return { key: s.key, kind: s.kind, category: "uncategorized", status: "needs review", anchor: anchor ?? "—", fingerprint: s.fingerprint, description: "" };
  });
}

const CATEGORY_ORDER: string[] = ["user-filtered", "anchored", "shared on purpose", "cross-user maintenance", "fragment", "uncategorized"];

const INTRO = `# Query audit (Spec 21.0)

Every SQL statement in \`apps/api/src\`, read and classified (Spec 21.0 §6.6). The rule everywhere is "you see your own
rows"; the only shared data is the reference catalog. This file is generated and checked: \`apps/api/scripts/query-audit.ts\`
extracts the statements from the TypeScript syntax tree, and a unit test fails when a statement is added, removed or edited
without its row changing here. After any SQL change run \`${WRITE_COMMAND}\`, then set the category of every row it marks
\`needs review\` (the test refuses that status).

Categories:

- **user-filtered**: the statement itself carries a user predicate (\`user_id = $acting\`, \`owner_user_id IS NULL OR owner_user_id = $acting\`, \`id = $acting\` on \`"user"\`, an \`ownership.ts\` helper, or an \`INSERT\` that writes the acting user's id).
- **anchored**: keyed by an id with no user predicate, but tied to an *anchor*: a user-filtered locking statement on the root row earlier in the same transaction (named in the Anchor column).
- **shared on purpose**: reference data (\`muscle_group\`, \`equipment\`, the catalog's \`owner_user_id IS NULL\` rows) or no table at all.
- **cross-user maintenance**: the operator scripts that act on many users (\`account/purge.ts\`, \`records/rebuild.ts\`, \`seed/catalog.ts\`).
- **fragment**: a piece composed into other statements, classified through the callers listed beside it.
`;

const cell = (s: string) => s.replace(/\|/g, "\\|");

export function writeAudit(existing: readonly AuditRow[], extracted: readonly Extracted[]): string {
  const rows = reconcile(existing, extracted);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const categories = [...counts.keys()].sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 99) % 99 - ((CATEGORY_ORDER.indexOf(b) + 99) % 99) || a.localeCompare(b));
  const review = rows.filter((r) => r.status !== "ok").length;
  const anchored = rows.filter((r) => r.category === "anchored");

  const out: string[] = [INTRO, "## Summary", ""];
  out.push(`${rows.length} statements: ${categories.map((c) => `${counts.get(c)} ${c}`).join(", ")}.${review > 0 ? ` **${review} need review.**` : ""}`, "");
  out.push("### Statements that rely on an earlier check (anchored)", "");
  if (anchored.length === 0) out.push("None.");
  for (const r of anchored) out.push(`- \`${r.key}\` relies on \`${r.anchor}\`${r.description ? `: ${r.description}` : ""}`);
  out.push("");

  const files = [...new Set(rows.map((r) => fileOf(r.key)))];
  for (const file of files) {
    out.push(`## ${file}`, "", "| Key | Kind | Category | Status | Anchor / callers | Fingerprint | Description |", "|---|---|---|---|---|---|---|");
    for (const r of rows.filter((x) => fileOf(x.key) === file)) {
      out.push(`| \`${r.key}\` | ${r.kind} | ${r.category} | ${r.status} | ${cell(r.anchor)} | \`${r.fingerprint}\` | ${cell(r.description)} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

/** The staleness and unsafe-call check. An empty list passes. */
export function checkAudit(extracted: readonly Extracted[], rows: readonly AuditRow[], allowlist: Readonly<Record<string, string>>): string[] {
  const failures: string[] = [];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const keys = new Set(extracted.map((s) => s.key));
  for (const s of extracted) {
    const row = byKey.get(s.key);
    if (!row) failures.push(`${s.file} ${s.fn}: statement ${s.key} has no audit row. Run \`${WRITE_COMMAND}\` and classify it.`);
    else if (row.fingerprint !== s.fingerprint) {
      failures.push(`${s.file} ${s.fn}: statement ${s.key} changed since it was audited. Run \`${WRITE_COMMAND}\` and review it.`);
    }
    for (const call of s.unsafe) {
      if (allowlist[`${s.file}#${s.fn}`] === undefined) failures.push(`${s.file} ${s.fn}: ${call} is not on UNSAFE_ALLOWLIST (statement ${s.key}).`);
    }
  }
  for (const r of rows) {
    if (!keys.has(r.key)) failures.push(`${r.key}: the audit has a row with no statement in code. Run \`${WRITE_COMMAND}\`.`);
    else if (r.status !== "ok" || r.category === "uncategorized") failures.push(`${r.key}: needs review — set its category and mark it ok.`);
  }
  return failures;
}
