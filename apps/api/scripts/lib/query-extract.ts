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
  /** Fragments only: the name callers refer to it by (its variable, else its function). */
  label?: string;
}

export type Category =
  | "user-filtered"
  | "anchored"
  | "shared on purpose"
  | "cross-user maintenance"
  | "fragment"
  | "uncategorized";

/** The five categories a classified row may have (§6.6). */
export const CATEGORIES: ReadonlySet<string> = new Set(["user-filtered", "anchored", "shared on purpose", "cross-user maintenance", "fragment"]);

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
  "src/db/rls.ts#setRls": "Table names come only from the constant RLS_LOCK_ORDER / RLS_TABLES, through quoteIdent; DDL cannot take bound parameters.",
  "src/repositories/exercise.prisma.ts#exerciseColumns":
    "Joins the constant EXERCISE_DB_COLUMNS list, optionally prefixed by the table alias, whose type is the literal `\"e\"`.",
  "src/repositories/planned-sets.ts#plannedSetsJson":
    "Table and column are literal-union parameters; the parent reference is a column literal at both call sites.",
  "src/repositories/section-timer-columns.ts#timedFieldsJson": "The section alias is the literal type `\"s\"`; the rest is constant text.",
  "src/repositories/section-timer-columns.ts#roundTimesJson": "The section reference is the literal type `\"s.id\" | '\"workout_section\".id'`; the rest is constant text.",
  "src/repositories/workout-section.prisma.ts#SECTION_COLUMNS": "A constant column list plus roundTimesJson of a column literal.",
  "src/repositories/workout.prisma.ts#workoutSectionsJson": "The parent reference is the literal type `\"w.id\" | '\"workout\".id'`; the rest is constant text.",
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

/** Prisma's model-delegate operations: `prisma.user.findUnique(…)` runs SQL too (final review #3). */
const MODEL_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "create", "createMany",
  "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany", "count", "aggregate", "groupBy",
]);

/** The Prisma client's model delegates (`prisma/schema.prisma`'s models, camel-cased); a test keeps the list in sync. */
export const MODEL_DELEGATES = new Set(["user", "exercise", "muscleGroup", "equipment", "workout", "workoutExercise", "routine", "routineItem", "routineItemSet", "workoutPlannedSet", "setEntry", "personalRecord", "routineSection", "workoutSection", "workoutSectionRound", "hevyExercisePair", "hevySectionRule", "hevyLink", "hevyAccount"]);

/** `<client>.<model>.<op>(…)` on a model delegate (`prisma.user.update`, `tx.workout.findMany`). */
function isModelCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || !MODEL_OPS.has(callee.name.text)) return false;
  const model = callee.expression;
  return ts.isPropertyAccessExpression(model) && MODEL_DELEGATES.has(model.name.text);
}

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
  pos: number;
  fileIndex: number;
}

export function extractStatements(sources: readonly Source[]): Extracted[] {
  const pending: Pending[] = [];
  const parsed = sources.map(({ file, text }) => ({ file, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) }));
  const covered: { file: string; pos: number; end: number }[] = [];

  parsed.forEach(({ file, sf }, fileIndex) => {
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
        } else if (isModelCall(node)) {
          found = { kind: "query", text: collapse(node.getText(sf)) };
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
          pos: node.getStart(sf),
          fileIndex,
        });
        covered.push({ file, pos: node.getStart(sf), end: node.getEnd() });
        return; // A template nested inside a statement is part of its text.
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  });

  // Second pass: a call of a fragment-building function (`plannedSetsJson(…)`) outside every statement composes SQL
  // that would otherwise reach a query only as a name; it is a fragment row of its own, so its arguments are
  // fingerprinted (final review #2: decorrelating `WE_PLANNED_SETS` must fail the check).
  const builders = new Set(pending.filter((p) => p.name && !p.name.local).map((p) => p.name!.name));
  const inside = (file: string, pos: number) => covered.some((c) => c.file === file && pos >= c.pos && pos < c.end);
  parsed.forEach(({ file, sf }, fileIndex) => {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && builders.has(node.expression.text) && !inside(file, node.getStart(sf))) {
        pending.push({
          file,
          fn: enclosingName(node),
          kind: "fragment",
          text: "${" + collapse(node.getText(sf)) + "}",
          unsafe: [],
          name: fragmentName(node),
          pos: node.getStart(sf),
          fileIndex,
        });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  });
  pending.sort((a, b) => a.fileIndex - b.fileIndex || a.pos - b.pos);

  const ordinals = new Map<string, number>();
  const rows: Extracted[] = pending.map((p) => {
    const at = `${p.file}#${p.fn}`;
    const ordinal = (ordinals.get(at) ?? 0) + 1;
    ordinals.set(at, ordinal);
    return {
      file: p.file,
      fn: p.fn,
      kind: p.kind,
      text: p.text,
      unsafe: p.unsafe,
      key: `${at}#${ordinal}`,
      ordinal,
      fingerprint: fingerprint(p.text),
      callers: [],
      ...(p.name ? { label: p.name.name } : {}),
    };
  });
  // Fragment callers: every other statement whose text names the fragment (a local one only within its function).
  pending.forEach((p, i) => {
    if (!p.name) return;
    const re = new RegExp(`(?<![\\w$])${p.name.name.replace(/[$]/g, "\\$")}(?![\\w$])`);
    rows[i]!.callers = rows
      .filter((r, j) => j !== i && re.test(r.text) && (!p.name!.local || (r.file === p.file && r.fn === p.fn)))
      .map((r) => r.key);
  });
  return rows;
}

/**
 * The statement's text with whitespace collapsed, every `${…}` kept as its source (Spec 21.0 §12 "as built", code
 * review #2): which id a predicate binds (`${actingUserId}` against `${body.userId}`) and which fragment is spliced
 * in (`${ownedSet(…)}` against `${Prisma.empty}`) are exactly the edits the audit exists to catch. Renaming a bound
 * variable re-flags the row; that friction is the review.
 */
export function fingerprint(text: string): string {
  return createHash("sha256").update(collapse(text)).digest("hex").slice(0, 12);
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

/**
 * The rows `--write` produces: classifications kept, moved statements matched by fingerprint, changed ones `needs
 * review`. Three passes over all statements (code review #1): every exact match and every moved match is settled
 * before any statement falls back to its key, so a statement inserted mid-function can't push the classifications
 * below it one row down.
 */
export function reconcile(existing: readonly AuditRow[], extracted: readonly Extracted[]): AuditRow[] {
  const unused = new Set(existing);
  const assigned = new Map<Extracted, { row: AuditRow; changed: boolean }>();
  const claim = (s: Extracted, row: AuditRow | undefined, changed: boolean) => {
    if (!row || assigned.has(s)) return;
    unused.delete(row);
    assigned.set(s, { row, changed });
  };
  for (const s of extracted) claim(s, existing.find((r) => unused.has(r) && r.key === s.key && r.fingerprint === s.fingerprint), false);
  for (const s of extracted) {
    if (assigned.has(s)) continue;
    claim(s, existing.find((r) => unused.has(r) && r.fingerprint === s.fingerprint && fileOf(r.key) === s.file && fnOf(r.key) === s.fn), false);
  }
  for (const s of extracted) {
    if (assigned.has(s)) continue;
    claim(s, existing.find((r) => unused.has(r) && r.key === s.key), true);
  }
  return extracted.map((s) => {
    const anchor = s.kind === "fragment" ? (s.callers.length > 0 ? `callers: ${s.callers.join(", ")}` : "callers: none") : undefined;
    const hit = assigned.get(s);
    if (!hit) return { key: s.key, kind: s.kind, category: "uncategorized", status: "needs review", anchor: anchor ?? "—", fingerprint: s.fingerprint, description: "" };
    return {
      ...hit.row,
      key: s.key,
      kind: s.kind,
      fingerprint: s.fingerprint,
      anchor: anchor ?? hit.row.anchor,
      ...(hit.changed ? { status: "needs review" } : {}),
    };
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
- **shared on purpose**: reference data (\`muscle_group\`, \`equipment\`, the catalog's \`owner_user_id IS NULL\` rows), Postgres's own catalogs (\`pg_*\`), or no table at all.
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
    else if (!CATEGORIES.has(r.category)) failures.push(`${r.key}: "${r.category}" is not a category (${[...CATEGORIES].join(", ")}).`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------------------
// Category sanity (AC21): coarse machine checks behind the human classification
// ---------------------------------------------------------------------------------------------------------------

/**
 * A user predicate in the statement's own text (code review #3: a predicate, not a mention of the column):
 * - `user_id = ${…}` / `owner_user_id = ${…}` (a filter or a join condition binding a value), or an `ownership.ts`
 *   helper call;
 * - an `INSERT` whose column list writes `user_id` / `owner_user_id` (it inserts the acting user's row);
 * - the `"user"` table itself keyed by id or by the token's subject (`auth_sub`, Spec 21.1 AC15's raw lookup), or
 *   inserted (provisioning, §6.7 #23), and the same through the Prisma `user` delegate keyed by id or the token's subject;
 * - a reference to one of `userFragments`: the names callers use for fragments whose own text is user-filtered.
 */
export function hasUserPredicate(text: string, userFragments: readonly string[] = []): boolean {
  if (/(?:^|[^\w])(?:owner_)?user_id\s*=\s*\$\{/.test(text) || /\$\{owned[A-Z]\w*\(/.test(text)) return true;
  if (/^INSERT INTO "\w+"\s*\([^)]*\b(?:owner_)?user_id\b/.test(text)) return true;
  if (/^INSERT INTO "user"/.test(text)) return true;
  if (/\b(?:FROM|UPDATE)\s+"user"/.test(text) && /(?<![\w.])(?:id|auth_sub)\s*=\s*\$\{/.test(text)) return true;
  if (/\.user\.\w+\(\{\s*where:\s*\{\s*(id|authSub)\b/.test(text)) return true;
  return userFragments.some((name) => new RegExp(`\\$\\{${name.replace(/[$]/g, "\\$")}(?![\\w$])`).test(text));
}

const SHARED_TABLES = new Set(["muscle_group", "equipment"]);
/** Reference tables, and Postgres's own catalogs (`pg_roles`, `pg_class`, …), which hold no user data (Spec 21.1). */
const isSharedTable = (t: string) => SHARED_TABLES.has(t) || t.startsWith("pg_");

/** Only reference data, the catalog's shared rows (`owner_user_id IS NULL`), Postgres's catalogs, or no table at all. */
export function touchesOnlySharedData(text: string): boolean {
  const { tables, delegates } = tablesOf(text);
  return (
    tables.every((t) => isSharedTable(t) || (t === "exercise" && /owner_user_id IS NULL/i.test(text))) &&
    delegates.every((d) => SHARED_DELEGATES.has(d))
  );
}

const MODEL_CALL_RE = /\.(\w+)\.(?:findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\(/g;
const SHARED_DELEGATES = new Set(["muscleGroup", "equipment"]);

/** The statement's text with the text of every fragment it names appended (to a small depth), for table detection. */
export function expandFragments(text: string, fragments: ReadonlyMap<string, string>, depth = 3): string {
  let out = text;
  for (const [name, body] of fragments) {
    if (new RegExp(`(?<![\\w$])${name.replace(/[$]/g, "\\$")}(?![\\w$])`).test(text)) {
      out += " " + (depth > 0 ? expandFragments(body, fragments, depth - 1) : body);
    }
  }
  return out;
}

/** Tables a statement touches, its fragments' included: SQL table names and Prisma model delegates. */
function tablesOf(text: string): { tables: string[]; delegates: string[] } {
  return {
    tables: [...text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+"?([a-z_]+)"?/gi)].map((m) => m[1]!.toLowerCase()),
    delegates: [...text.matchAll(MODEL_CALL_RE)].map((m) => m[1]!).filter((d) => MODEL_DELEGATES.has(d)),
  };
}

/**
 * AC21 — every check behind the human classification, over the whole audit. An empty list passes.
 * - user-filtered: a user predicate in the statement's own text (or a call of a user-filtered fragment);
 * - shared on purpose: only reference data or the catalog's shared rows, its fragments' tables included;
 * - cross-user maintenance: only in the three operator scripts;
 * - anchored: the anchor exists, is user-filtered, and locks or inserts the root row;
 * - fragment: lists its callers, each classified, and a fragment over owned tables only has callers that are
 *   user-filtered, anchored, maintenance or fragments themselves (§6.7 #17).
 */
export function sanityIssues(rows: readonly AuditRow[], extracted: readonly Extracted[]): string[] {
  const issues: string[] = [];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const textOf = new Map(extracted.map((s) => [s.key, s.text]));
  const fragments = new Map(extracted.filter((s) => s.kind === "fragment").map((s) => [fragmentLabel(s), s.text]));
  const userFragments = extracted.filter((s) => s.kind === "fragment" && hasUserPredicate(s.text)).map(fragmentLabel);
  const ownsData = (text: string) => {
    const { tables, delegates } = tablesOf(expandFragments(text, fragments));
    return tables.some((t) => !isSharedTable(t) && !(t === "exercise" && /owner_user_id IS NULL/i.test(text))) || delegates.some((d) => !SHARED_DELEGATES.has(d));
  };
  for (const r of rows) {
    const text = textOf.get(r.key) ?? "";
    if ((r.category === "fragment") !== (r.kind === "fragment")) issues.push(`${r.key}: a ${r.kind} classified "${r.category}"`);
    switch (r.category) {
      case "user-filtered":
        if (!hasUserPredicate(text, userFragments)) issues.push(`${r.key}: user-filtered, but its text has no user predicate`);
        break;
      case "shared on purpose":
        if (ownsData(text)) issues.push(`${r.key}: shared on purpose, but it (or a fragment it uses) touches user data`);
        break;
      case "cross-user maintenance":
        if (!/^src\/(account\/purge|records\/rebuild|seed\/catalog)\.ts#/.test(r.key)) issues.push(`${r.key}: cross-user maintenance outside the operator scripts`);
        break;
      case "anchored": {
        const anchor = byKey.get(r.anchor.replace(/`/g, ""));
        const anchorText = anchor ? (textOf.get(anchor.key) ?? "") : "";
        if (!anchor || anchor.category !== "user-filtered" || !/FOR (UPDATE|SHARE)\b|^INSERT\b/i.test(anchorText)) {
          issues.push(`${r.key}: its anchor ${r.anchor} is missing, not user-filtered, or neither locks nor inserts`);
        }
        break;
      }
      case "fragment": {
        const callers = r.anchor.replace(/^callers: /, "").split(", ").filter((k) => k !== "none" && k !== "");
        if (callers.length === 0 && !r.key.startsWith("src/repositories/ownership.ts#")) issues.push(`${r.key}: a fragment with no callers`);
        const owned = ownsData(text);
        for (const c of callers) {
          const row = byKey.get(c);
          if (!row || !CATEGORIES.has(row.category)) issues.push(`${r.key}: caller ${c} is not classified`);
          else if (owned && row.category === "shared on purpose") issues.push(`${r.key}: caller ${c} is shared on purpose, but the fragment reads user data`);
        }
        break;
      }
    }
  }
  return issues;
}

/** The name a fragment is referred to by in its callers' text (the label `extractStatements` searched for). */
function fragmentLabel(s: Extracted): string {
  return s.label ?? s.fn;
}
