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
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return name === "seed" ? [] : tsFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

/** The text of every template literal in a file, with `${…}` holes as `?` so a comma inside one cannot split a column. */
function templates(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    if (ts.isTemplateExpression(node)) out.push([node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("?"));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The assigned column names of a `SET` list: split on top-level commas, keep what is before each `=`. */
export function setColumns(setList: string): string[] {
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
  return parts.map((p) => p.split("=")[0]!.trim().replace(/^"|"$/g, "")).filter((c) => c !== "");
}

function updateStatements(): { file: string; table: string; columns: string[] }[] {
  const found: { file: string; table: string; columns: string[] }[] = [];
  for (const file of tsFiles(SRC)) {
    for (const text of templates(file)) {
      for (const m of text.matchAll(/UPDATE\s+"(user|exercise)"\s+SET\s+([\s\S]*?)\s+(?:WHERE|RETURNING)\b/g)) {
        found.push({ file: file.slice(SRC.length + 1), table: m[1]!, columns: setColumns(m[2]!) });
      }
    }
  }
  return found;
}

describe("Spec 21.1 Review Focus 2 — every column the API updates is granted to sin_app", () => {
  const statements = updateStatements();

  it("finds the API's statements (a broken scan cannot pass silently)", () => {
    expect(statements.filter((s) => s.table === "user").length).toBeGreaterThanOrEqual(3);
    expect(statements.filter((s) => s.table === "exercise").length).toBeGreaterThanOrEqual(2);
  });

  it("every SET column is on the grant list", () => {
    const missing = statements.flatMap((s) =>
      s.columns.filter((c) => !APP_GRANTS[s.table]!.columns!.UPDATE.includes(c)).map((c) => `${s.file}: UPDATE "${s.table}" SET ${c}`),
    );
    expect(missing).toEqual([]);
  });

  it("the parser reads a CASE, a COALESCE and an array cast as one column each", () => {
    expect(setColumns("a = CASE WHEN ?::boolean THEN ?::text ELSE a END, b = COALESCE(?::text, b),\n c = ?::text[], d = now()")).toEqual(["a", "b", "c", "d"]);
  });
});
