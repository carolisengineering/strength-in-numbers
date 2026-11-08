// apps/api/test/unit/http-tests-on-app-login.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Spec 21.1 AC30 — every HTTP-level integration test builds its app on `sin_app`, so a statement the restricted login
 * cannot run fails in CI, not at the staging switch. Fixtures, truncation and assertions on stored rows stay on the
 * superuser. A new test that calls `buildApp` / `buildTestApp` with `db.prisma` fails here.
 */

const DIR = fileURLToPath(new URL("../integration", import.meta.url));

/** `path relative to test/integration` → why this file may build its app another way. Empty at this commit. */
const ALLOWED: Record<string, string> = {};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

interface CallSite {
  file: string;
  line: number;
  text: string;
}

function appCalls(): CallSite[] {
  const out: CallSite[] = [];
  for (const file of files(DIR)) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(buildApp|buildTestApp|makeCrossUserApp|makeAccountApp)$/.test(node.expression.text)) {
        out.push({ file: file.slice(DIR.length + 1), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.getText(sf) });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

const isHelperCall = (text: string) => /^(makeCrossUserApp|makeAccountApp)\(/.test(text);

describe("Spec 21.1 AC30 — every HTTP-level integration test builds its app on sin_app", () => {
  const calls = appCalls();

  it("finds them (a broken scan cannot pass silently)", () => {
    expect(calls.length).toBeGreaterThanOrEqual(20);
  });

  it("no call hands the app the superuser client, and each names db.app (or a helper that does)", () => {
    const bad = calls
      .filter((c) => !(c.file in ALLOWED))
      .filter((c) => c.text.includes(".prisma") || !(isHelperCall(c.text) || /\.app\b/.test(c.text)))
      .map((c) => `${c.file}:${c.line}`);
    expect(bad).toEqual([]);
  });

  it("the two helpers build on sin_app themselves", () => {
    for (const helper of ["cross-user/app.ts", "account-helpers.ts"]) {
      const text = readFileSync(`${DIR}/${helper}`, "utf8");
      expect([helper, text.includes("appRepositories(db.app)")]).toEqual([helper, true]);
      expect([helper, /Repository\(db\.prisma/.test(text)]).toEqual([helper, false]);
    }
  });
});
