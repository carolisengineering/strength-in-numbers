// apps/api/test/unit/update-columns-granted.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { APP_GRANTS } from "../integration/app-grants.js";

/**
 * Spec 21.1 Review Focus 2 — a column the API writes but `sin_app` may not update fails only at runtime with `42501`
 * (at the staging switch, or in production). This reads the SQL of every `UPDATE "user"` and `UPDATE "exercise"` under
 * `src` (the seed runs as the owner, so it is skipped) and checks each `SET` column against the grant list.
 *
 * Minor 412: the statement may carry an alias, an unquoted name, `SET … FROM`, or be an `INSERT … ON CONFLICT … DO UPDATE
 * SET`. A `SET` list the scan can't read (a `${fragment}` where a column should be) fails on these two tables unless
 * `UPDATE_COLUMN_OVERRIDES` lists its columns. A table named by a `${…}` is not seen.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return name === "seed" ? [] : tsFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

interface Template {
  /** Relative to `src`. */
  file: string;
  /** The enclosing named function, else `(module)`. */
  fn: string;
  text: string;
}

function enclosingName(node: ts.Node): string {
  for (let p = node.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText();
  }
  return "(module)";
}

/** Every template literal in a file, with `${…}` holes as `?` so a comma inside one cannot split a column. */
function templates(file: string): Template[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: Template[] = [];
  const add = (node: ts.Node, text: string) => out.push({ file: file.slice(SRC.length + 1), fn: enclosingName(node), text });
  const visit = (node: ts.Node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    if (ts.isTemplateExpression(node)) add(node, [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("?"));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** A `SET` list split on its top-level commas. */
function splitTopLevel(setList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of setList) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** The assigned column names of a `SET` list: split on top-level commas, keep what is before each `=`. */
export function setColumns(setList: string): string[] {
  return splitTopLevel(setList)
    .map((p) => p.split("=")[0]!.trim().replace(/^"|"$/g, ""))
    .filter((c) => c !== "");
}

/** `UPDATE [ONLY] <table> [[AS] alias] SET `, the table quoted or not. `FOR UPDATE` has no `SET` and never matches. */
const UPDATE_HEAD = /\bUPDATE\s+(?:ONLY\s+)?("?)(\w+)\1(?:\s+(?:AS\s+)?(?!SET\b)\w+)?\s+SET\s+/gi;
/**
 * `INSERT INTO <table> … ON CONFLICT … DO UPDATE SET `. Neither gap may cross another `INSERT INTO`, so in a statement
 * with two inserts (a CTE) the upsert belongs to the insert it follows, not to the first one.
 */
const NO_INSERT = String.raw`(?:(?!\bINSERT\s+INTO\b)[\s\S])*?`;
const UPSERT_HEAD = new RegExp(String.raw`\bINSERT\s+INTO\s+("?)(\w+)\1${NO_INSERT}\bON\s+CONFLICT\b${NO_INSERT}\bDO\s+UPDATE\s+SET\s+`, "gi");
const SET_END = /^(?:FROM|WHERE|RETURNING)\b/i;

/** The `SET` list that starts at `from`: up to the first `FROM` / `WHERE` / `RETURNING` outside parentheses, or the end. */
function setListAt(text: string, from: number): string {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && /\W/.test(text[i - 1] ?? " ") && SET_END.test(text.slice(i, i + 10))) return text.slice(from, i);
  }
  return text.slice(from);
}

/** Each part of a `SET` list assigns one plain column (`name = …` or `"name" = …`). */
const READABLE_PART = /^\s*"?\w+"?\s*=/;

export interface UpdateTarget {
  table: string;
  /** `null` when the `SET` list can't be read: a `${fragment}` (here `?`) or a row constructor in a column's place. */
  columns: string[] | null;
}

/** Minor 412: every table a statement updates, with the columns it sets. */
export function updateTargets(text: string): UpdateTarget[] {
  const out: UpdateTarget[] = [];
  for (const head of [UPDATE_HEAD, UPSERT_HEAD]) {
    for (const m of text.matchAll(head)) {
      const setList = setListAt(text, m.index + m[0].length);
      const readable = splitTopLevel(setList).every((part) => READABLE_PART.test(part));
      out.push({ table: m[2]!.toLowerCase(), columns: readable ? setColumns(setList) : null });
    }
  }
  return out;
}

const CHECKED_TABLES = new Set(["user", "exercise"]);

interface CheckedStatement extends UpdateTarget {
  /** `<file relative to src>#<enclosing function>`. */
  key: string;
}

/** The update targets on the two tables whose columns are granted one by one. */
function checkedStatements(sources: readonly Template[]): CheckedStatement[] {
  return sources.flatMap((t) => updateTargets(t.text).filter((u) => CHECKED_TABLES.has(u.table)).map((u) => ({ key: `${t.file}#${t.fn}`, ...u })));
}

/**
 * The columns of a `SET` list the scan can't read, keyed `<file relative to src>#<enclosing function>`, each with the
 * reason the list is built from a fragment. None today.
 */
const UPDATE_COLUMN_OVERRIDES: Readonly<Record<string, { columns: string[]; reason: string }>> = {};

function columnIssues(statements: readonly CheckedStatement[], overrides: Readonly<Record<string, { columns: string[]; reason: string }>>): string[] {
  return statements.flatMap((s) => {
    const columns = s.columns ?? overrides[s.key]?.columns;
    if (columns === undefined) return [`${s.key}: UPDATE "${s.table}": can't read the SET list; list its columns in UPDATE_COLUMN_OVERRIDES`];
    return columns.filter((c) => !APP_GRANTS[s.table]!.columns!.UPDATE.includes(c)).map((c) => `${s.key}: UPDATE "${s.table}" SET ${c}`);
  });
}

describe("Spec 21.1 Review Focus 2 — every column the API updates is granted to sin_app", () => {
  const statements = checkedStatements(tsFiles(SRC).flatMap(templates));

  it("finds the API's statements (a broken scan cannot pass silently)", () => {
    expect(statements.filter((s) => s.table === "user").length).toBeGreaterThanOrEqual(3);
    expect(statements.filter((s) => s.table === "exercise").length).toBeGreaterThanOrEqual(2);
  });

  it("every SET column is on the grant list, and every SET list can be read", () => {
    expect(columnIssues(statements, UPDATE_COLUMN_OVERRIDES)).toEqual([]);
  });

  it.each([
    ["an alias", 'UPDATE "exercise" e SET name = ? WHERE e.id = ?', "exercise", ["name"]],
    ["an AS alias", 'UPDATE "user" AS u SET display_name = ? WHERE u.id = ?', "user", ["display_name"]],
    ["an unquoted name", "UPDATE exercise SET name = ?, notes = ? RETURNING id", "exercise", ["name", "notes"]],
    ["SET … FROM", 'UPDATE "user" SET a = b.x FROM y b WHERE b.id = "user".id', "user", ["a"]],
    ["a subquery with its own FROM and WHERE", 'UPDATE "user" SET a = (SELECT max(z) FROM t WHERE t.id = ?), b = ? WHERE id = ?', "user", ["a", "b"]],
    ["ON CONFLICT DO UPDATE", 'INSERT INTO "user" (id, display_name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name', "user", ["display_name"]],
    ["ON CONFLICT DO UPDATE with a WHERE", "INSERT INTO exercise (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, notes = ? WHERE exercise.owner_id = ?", "exercise", ["name", "notes"]],
    ["no WHERE at all", 'UPDATE "user" SET a = now()', "user", ["a"]],
  ])("minor 412 — the parser reads %s", (_name, sql, table, columns) => {
    expect(updateTargets(sql)).toEqual([{ table, columns }]);
  });

  it("minor 412 — an upsert after another insert in the same statement is read for its own table (code review)", () => {
    const cte = 'WITH a AS (INSERT INTO "hevy_account" (user_id) VALUES (?) RETURNING user_id) INSERT INTO "user" (id, display_name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name';
    expect(updateTargets(cte)).toEqual([{ table: "user", columns: ["display_name"] }]);
    const both = 'WITH a AS (INSERT INTO "hevy_account" (user_id) VALUES (?) ON CONFLICT DO NOTHING) INSERT INTO "user" (id) VALUES (?) ON CONFLICT (id) DO UPDATE SET email = ?';
    expect(updateTargets(both)).toEqual([{ table: "user", columns: ["email"] }]);
  });

  it("minor 412 — a SET list with a fragment in a column's place can't be read", () => {
    expect(updateTargets('UPDATE "user" SET ? WHERE id = ?')).toEqual([{ table: "user", columns: null }]);
    expect(updateTargets('UPDATE "user" SET a = ?, ? WHERE id = ?')).toEqual([{ table: "user", columns: null }]);
  });

  it("minor 412 — a row lock is not an update", () => {
    expect(updateTargets('SELECT id FROM "user" WHERE id = ? FOR UPDATE')).toEqual([]);
    expect(updateTargets('SELECT id FROM "user" WHERE id = ? FOR NO KEY UPDATE OF "user"')).toEqual([]);
  });

  it("minor 412 — an unreadable SET list on user or exercise fails, unless UPDATE_COLUMN_OVERRIDES lists its columns", () => {
    const statement = { key: "repositories/x.ts#f", table: "user", columns: null };
    expect(columnIssues([statement], {})).toEqual(['repositories/x.ts#f: UPDATE "user": can\'t read the SET list; list its columns in UPDATE_COLUMN_OVERRIDES']);
    expect(columnIssues([statement], { "repositories/x.ts#f": { columns: ["display_name"], reason: "a test" } })).toEqual([]);
    expect(columnIssues([statement], { "repositories/x.ts#f": { columns: ["id"], reason: "a test" } })).toEqual(['repositories/x.ts#f: UPDATE "user" SET id']);
  });

  it("minor 412 — only user and exercise are checked: another table's fragment SET list is no failure (Review Focus 3)", () => {
    expect(updateTargets('UPDATE "workout" SET ? WHERE id = ?')).toEqual([{ table: "workout", columns: null }]);
    expect(checkedStatements([{ file: "repositories/x.ts", fn: "f", text: 'UPDATE "workout" SET ? WHERE id = ?' }])).toEqual([]);
    expect(checkedStatements([{ file: "repositories/x.ts", fn: "f", text: 'UPDATE "user" SET ? WHERE id = ?' }])).toEqual([{ key: "repositories/x.ts#f", table: "user", columns: null }]);
  });

  it("minor 412 — every override still names an unreadable statement (the map can't go stale)", () => {
    const unreadable = statements.filter((s) => s.columns === null).map((s) => s.key);
    expect(Object.keys(UPDATE_COLUMN_OVERRIDES).filter((k) => !unreadable.includes(k))).toEqual([]);
  });

  it("the parser reads a CASE, a COALESCE and an array cast as one column each", () => {
    expect(setColumns("a = CASE WHEN ?::boolean THEN ?::text ELSE a END, b = COALESCE(?::text, b),\n c = ?::text[], d = now()")).toEqual(["a", "b", "c", "d"]);
  });
});
