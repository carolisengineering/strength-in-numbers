import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MODEL_DELEGATES,
  UNSAFE_ALLOWLIST,
  checkAudit,
  extractStatements,
  fingerprint,
  parseAudit,
  hasUserPredicate,
  sanityIssues,
  writeAudit,
  type Source,
} from "../../scripts/lib/query-extract.js";
import { AUDIT_PATH, readSources } from "../../scripts/query-audit.js";

/** Spec 21.0 §6.6, AC19, AC20, AC28, AC30 — the query extractor and the audit's staleness check. */

const src = (file: string, text: string): Source => ({ file, text });

const REPO = src(
  "src/repositories/thing.prisma.ts",
  `
import { Prisma } from "@prisma/client";
export const THING_COLUMNS = Prisma.sql\`id, name, user_id\`;
export function createThingRepository(prisma: unknown) {
  return {
    async find(userId: string, id: string) {
      const rows = await prisma.$queryRaw<{ id: string }[]>\`
        SELECT \${THING_COLUMNS} FROM "thing"
        WHERE id = \${id}::uuid AND user_id = \${userId}::uuid\`;
      return rows;
    },
    async remove(userId: string, id: string) {
      await prisma.$transaction(async (tx) => {
        const db = tx;
        await db.$executeRaw\`DELETE FROM "thing" WHERE id = \${id}::uuid AND user_id = \${userId}::uuid\`;
        await tx.$queryRaw(Prisma.sql\`SELECT 1\`);
      });
    },
  };
}
`,
);

describe("AC19 — statements are extracted from the TypeScript syntax tree", () => {
  const out = extractStatements([REPO]);
  const keys = out.map((s) => s.key);

  it("finds tagged $queryRaw / $executeRaw, through an aliased client too, and a $queryRaw(Prisma.sql…) call", () => {
    expect(keys).toEqual([
      "src/repositories/thing.prisma.ts#THING_COLUMNS#1",
      "src/repositories/thing.prisma.ts#find#1",
      "src/repositories/thing.prisma.ts#remove#1",
      "src/repositories/thing.prisma.ts#remove#2",
    ]);
    expect(out.map((s) => s.kind)).toEqual(["fragment", "query", "query", "query"]);
  });

  it("keeps the statement text with whitespace collapsed", () => {
    expect(out[2]!.text).toBe('DELETE FROM "thing" WHERE id = ${id}::uuid AND user_id = ${userId}::uuid');
  });

  it("lists a fragment's callers", () => {
    expect(out[0]!.callers).toEqual(["src/repositories/thing.prisma.ts#find#1"]);
  });

  it("a Prisma.sql fragment exported from one file and run in another is one fragment row with its caller (Review Focus 5)", () => {
    const shared = src("src/repositories/shared.ts", 'import { Prisma } from "@prisma/client";\nexport const OWNED = (u: string) => Prisma.sql`user_id = ${u}::uuid`;');
    const user = src(
      "src/repositories/user-of-shared.ts",
      'import { OWNED } from "./shared.js";\nexport async function list(db: unknown, u: string) { return db.$queryRaw`SELECT id FROM "thing" WHERE ${OWNED(u)}`; }',
    );
    const both = extractStatements([shared, user]);
    expect(both.map((s) => [s.key, s.kind])).toEqual([
      ["src/repositories/shared.ts#OWNED#1", "fragment"],
      ["src/repositories/user-of-shared.ts#list#1", "query"],
    ]);
    expect(both[0]!.callers).toEqual(["src/repositories/user-of-shared.ts#list#1"]);
  });

  it("a fragment built in a .map callback and joined into a query lists that query as its caller", () => {
    const mapped = src(
      "src/repositories/m.ts",
      `export async function insertItems(tx: unknown, items: { a: string }[], r: string) {
        const values = items.map((it, i) => Prisma.sql\`(\${it.a}, \${r}::uuid, \${i})\`);
        const more = items.flatMap((it) => [1].map(() => { return Prisma.sql\`(\${it.a})\`; }));
        await tx.$executeRaw\`INSERT INTO "routine_item" (a, routine_id, position) VALUES \${Prisma.join(values)}\`;
        await tx.$executeRaw\`INSERT INTO "x" (a) VALUES \${Prisma.join(more)}\`;
      }`,
    );
    const rows = extractStatements([mapped]);
    expect(rows.map((r) => [r.key, r.callers])).toEqual([
      ["src/repositories/m.ts#insertItems#1", ["src/repositories/m.ts#insertItems#3"]],
      ["src/repositories/m.ts#insertItems#2", ["src/repositories/m.ts#insertItems#4"]],
      ["src/repositories/m.ts#insertItems#3", []],
      ["src/repositories/m.ts#insertItems#4", []],
    ]);
  });

  it("a statement in a local arrow is filed under the enclosing method, and a local fragment finds it", () => {
    const local = src(
      "src/repositories/l.ts",
      `export function repo(prisma: unknown) { return {
        async updateExercise(u: string, id: string, g: boolean) {
          const typeGuard = g ? Prisma.sql\`AND NOT locked\` : Prisma.empty;
          const write = () => prisma.$queryRaw\`UPDATE "exercise" SET n = 1 WHERE id = \${id}::uuid AND owner_user_id = \${u}::uuid \${typeGuard}\`;
          return write();
        },
      }; }`,
    );
    const rows = extractStatements([local]);
    expect(rows.map((r) => [r.key, r.callers])).toEqual([
      ["src/repositories/l.ts#updateExercise#1", ["src/repositories/l.ts#updateExercise#2"]],
      ["src/repositories/l.ts#updateExercise#2", []],
    ]);
  });

  it("a call of a fragment-building function outside any template is a fragment row whose arguments are fingerprinted", () => {
    const builder = (parent: string) =>
      src(
        "src/repositories/b.ts",
        `export function plannedJson(table: "a_set", parentRef: string) { return Prisma.raw(\`(SELECT json_agg(x) FROM "\${table}" x WHERE x.p = \${parentRef})\`); }
         const WE_PLANNED = plannedJson("a_set", '${parent}');
         export async function read(db: unknown, u: string) { return db.$queryRaw\`SELECT \${WE_PLANNED} FROM "w" WHERE user_id = \${u}::uuid\`; }`,
      );
    const rows = extractStatements([builder('"w".id')]);
    expect(rows.map((r) => [r.key, r.kind])).toEqual([
      ["src/repositories/b.ts#plannedJson#1", "fragment"],
      ["src/repositories/b.ts#WE_PLANNED#1", "fragment"],
      ["src/repositories/b.ts#read#1", "query"],
    ]);
    expect(rows[1]!.callers).toEqual(["src/repositories/b.ts#read#1"]);
    expect(rows[0]!.callers).toContain("src/repositories/b.ts#WE_PLANNED#1");
    // Decorrelating the subquery (the parent ref) must change the fingerprint (final review #2).
    const decorrelated = extractStatements([builder("x.p")]);
    expect(decorrelated[1]!.fingerprint).not.toBe(rows[1]!.fingerprint);
  });

  it("a Prisma model-delegate call is a query row too (final review #3)", () => {
    const model = src(
      "src/repositories/u.ts",
      `export function repo(prisma: unknown) { return {
        async touch(id: string) { return prisma.workout.update({ where: { id }, data: { title: null } }); },
        async other(m: Map<string, string>) { return m.get("x"); },
      }; }`,
    );
    expect(extractStatements([model]).map((r) => [r.key, r.kind, r.text])).toEqual([
      ["src/repositories/u.ts#touch#1", "query", "prisma.workout.update({ where: { id }, data: { title: null } })"],
    ]);
  });

  it("a Prisma.sql nested inside another statement is part of that statement, not a row of its own", () => {
    const nested = src(
      "src/repositories/n.ts",
      'export async function f(db: unknown, u: string, x: boolean) { return db.$queryRaw`SELECT 1 FROM "t" WHERE a ${x ? Prisma.sql`AND user_id = ${u}::uuid` : Prisma.empty}`; }',
    );
    const rows = extractStatements([nested]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toContain("AND user_id = ${u}::uuid");
  });

  it("a $queryRawUnsafe, $executeRawUnsafe or Prisma.raw not on UNSAFE_ALLOWLIST fails the check", () => {
    const unsafe = src(
      "src/repositories/unsafe.ts",
      'export async function f(db: unknown, s: string) { await db.$queryRawUnsafe(`SELECT ${s}`); await db.$executeRawUnsafe("DELETE"); return Prisma.raw(s); }',
    );
    const rows = extractStatements([unsafe]);
    const failures = checkAudit(rows, parseAudit(writeAudit([], rows)), {});
    expect(failures.filter((f) => f.includes("not on UNSAFE_ALLOWLIST"))).toHaveLength(3);
  });

  it("an allow-listed Prisma.raw is extracted as a fragment and passes the unsafe check", () => {
    const raw = src("src/repositories/raw.ts", 'export const COLS = Prisma.raw(`id, name`);');
    const rows = extractStatements([raw]);
    expect(rows.map((r) => [r.key, r.kind, r.text])).toEqual([["src/repositories/raw.ts#COLS#1", "fragment", "id, name"]]);
    const failures = checkAudit(rows, parseAudit(writeAudit([], rows)), { "src/repositories/raw.ts#COLS": "constant column list" });
    expect(failures.filter((f) => f.includes("UNSAFE_ALLOWLIST"))).toEqual([]);
  });
});

describe("AC20 — the fingerprint and the staleness check", () => {
  it("collapses whitespace, and keeps every ${…} (a renamed binding re-flags its row)", () => {
    expect(fingerprint("SELECT  id\n FROM t WHERE id = ${id}::uuid")).toBe(fingerprint("SELECT id FROM t WHERE id = ${id}::uuid"));
    expect(fingerprint("SELECT id FROM t WHERE id = ${id}::uuid")).not.toBe(fingerprint("SELECT id FROM t WHERE id = ${other}::uuid"));
  });

  it("keeps a ${…} that composes SQL, so swapping a predicate fragment changes it", () => {
    expect(fingerprint("DELETE FROM t WHERE id = ${id}::uuid AND ${ownedSet(u, Prisma.sql`t.id`)}")).not.toBe(
      fingerprint("DELETE FROM t WHERE id = ${id}::uuid AND ${Prisma.empty}"),
    );
  });

  it("binding a different id to the user predicate changes it (code review #2)", () => {
    expect(fingerprint("SELECT 1 FROM t WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid")).not.toBe(
      fingerprint("SELECT 1 FROM t WHERE id = ${id}::uuid AND user_id = ${body.userId}::uuid"),
    );
  });

  it("--write keeps each classification on its own statement when one is inserted before it (code review #1)", () => {
    const three = (body: string) => src("src/repositories/k.ts", `export async function f(db: unknown, u: string) { ${body} }`);
    const X = 'await db.$queryRaw`SELECT 1 FROM "x" WHERE user_id = ${u}::uuid`;';
    const Y = 'await db.$queryRaw`SELECT 2 FROM "y" WHERE user_id = ${u}::uuid`;';
    const N = 'await db.$queryRaw`SELECT 3 FROM "n" WHERE user_id = ${u}::uuid`;';
    const before = extractStatements([three(X + Y)]);
    const classifiedBefore = parseAudit(writeAudit([], before)).map((r, i) => ({ ...r, status: "ok", category: "user-filtered", description: i === 0 ? "the X read" : "the Y read" }));
    const after = parseAudit(writeAudit(classifiedBefore, extractStatements([three(N + X + Y)]))).map((r) => [r.key, r.status, r.description]);
    expect(after).toEqual([
      ["src/repositories/k.ts#f#1", "needs review", ""],
      ["src/repositories/k.ts#f#2", "ok", "the X read"],
      ["src/repositories/k.ts#f#3", "ok", "the Y read"],
    ]);
  });

  it("is 12 hex characters", () => {
    expect(fingerprint("SELECT 1")).toMatch(/^[0-9a-f]{12}$/);
  });

  const rows = extractStatements([REPO]);
  const classified = () =>
    parseAudit(writeAudit([], rows)).map((r) => ({ ...r, category: "user-filtered", status: "ok", description: "a statement" }));

  it("passes when every statement has a classified row with its fingerprint", () => {
    expect(checkAudit(rows, classified(), {})).toEqual([]);
  });

  it("fails on a statement with no row, naming the file, the function and the --write command", () => {
    const failures = checkAudit(rows, classified().slice(1), {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("src/repositories/thing.prisma.ts");
    expect(failures[0]).toContain("THING_COLUMNS");
    expect(failures[0]).toContain("pnpm --filter @sin/api run audit:queries --write");
  });

  it("fails on a row whose statement is gone", () => {
    const extra = [...classified(), { ...classified()[1]!, key: "src/repositories/thing.prisma.ts#gone#1" }];
    expect(checkAudit(rows, extra, {}).some((f) => f.includes("gone#1") && f.includes("no statement"))).toBe(true);
  });

  it("fails on an edited statement, and --write keeps its classification but marks it needs review", () => {
    const edited = extractStatements([src(REPO.file, REPO.text.replace("AND user_id = ${userId}::uuid`;\n        await tx", "`;\n        await tx"))]);
    const failures = checkAudit(edited, classified(), {});
    expect(failures.some((f) => f.includes("remove") && f.includes("changed") && f.includes("audit:queries --write"))).toBe(true);

    const rewritten = parseAudit(writeAudit(classified(), edited));
    const row = rewritten.find((r) => r.key === "src/repositories/thing.prisma.ts#remove#1")!;
    expect(row.category).toBe("user-filtered");
    expect(row.status).toBe("needs review");
    expect(checkAudit(edited, rewritten, {}).some((f) => f.includes("needs review"))).toBe(true);
  });

  it("fails on a category outside the five (a typo is effectively uncategorized, AC21)", () => {
    const typo = classified().map((r, i) => (i === 0 ? { ...r, category: "user filtered" } : r));
    expect(checkAudit(rows, typo, {}).some((f) => f.includes("user filtered") && f.includes("not a category"))).toBe(true);
  });

  it("--write adds a new statement as uncategorized and needs review", () => {
    const rewritten = parseAudit(writeAudit([], rows));
    expect(rewritten.every((r) => r.status === "needs review" && r.category === "uncategorized")).toBe(true);
  });

  it("--write keeps a row whose statement only moved within its function (matched by fingerprint)", () => {
    const moved = extractStatements([
      src(REPO.file, REPO.text.replace("await tx.$queryRaw(Prisma.sql`SELECT 1`);", "").replace("const db = tx;", "const db = tx;\n        await tx.$queryRaw(Prisma.sql`SELECT 1`);")),
    ]);
    const rewritten = parseAudit(writeAudit(classified(), moved));
    expect(rewritten.every((r) => r.status === "ok")).toBe(true);
  });

  it("the audit document round-trips through parse and write", () => {
    const doc = writeAudit(classified(), rows);
    expect(writeAudit(parseAudit(doc), rows)).toBe(doc);
  });
});

describe("AC21 — hasUserPredicate wants a predicate, not a mention (code review #3, #4)", () => {
  it("a user_id that is only selected or returned is no user predicate", () => {
    expect(hasUserPredicate('SELECT user_id, ended_at FROM "workout" WHERE id = ${id}::uuid')).toBe(false);
    expect(hasUserPredicate('UPDATE "workout" SET title = ${t} WHERE id = ${id}::uuid RETURNING id, user_id')).toBe(false);
    expect(hasUserPredicate('SELECT id FROM "exercise" WHERE owner_user_id IS NULL')).toBe(false);
    expect(hasUserPredicate('SELECT w.id FROM "workout" w JOIN "user" u ON u.id = w.user_id WHERE w.id = ${id}::uuid')).toBe(false);
  });

  it("a filter, a join condition or an inserted owner column is", () => {
    expect(hasUserPredicate('SELECT 1 FROM "workout" WHERE id = ${id}::uuid AND user_id = ${u}::uuid')).toBe(true);
    expect(hasUserPredicate('SELECT 1 FROM "exercise" WHERE (owner_user_id IS NULL OR owner_user_id = ${u}::uuid)')).toBe(true);
    expect(hasUserPredicate('SELECT 1 FROM "set_entry" se JOIN "workout" w ON w.id = se.wid AND w.user_id = ${u}::uuid')).toBe(true);
    expect(hasUserPredicate('INSERT INTO "routine" (id, user_id, name) VALUES (${id}::uuid, ${u}::uuid, ${n})')).toBe(true);
    expect(hasUserPredicate('UPDATE "user" SET deleted_at = now() WHERE id = ${id}::uuid')).toBe(true);
  });

  it("Spec 21.1 AC15 — a raw read of the user row by the token's auth_sub is one (it replaced the model lookup)", () => {
    expect(hasUserPredicate('SELECT ${USER_COLUMNS} FROM "user" WHERE auth_sub = ${authSub}')).toBe(true);
    // Only on "user": an auth_sub compared anywhere else is no user predicate.
    expect(hasUserPredicate('SELECT 1 FROM "workout" WHERE auth_sub = ${authSub}')).toBe(false);
  });

  it("a user-filtered fragment counts by the name its callers use, not its enclosing function", () => {
    const local = src(
      "src/repositories/lf.ts",
      `export async function foo(db: unknown, u: string) {
         const ownerFilter = Prisma.sql\`user_id = \${u}::uuid\`;
         return db.$queryRaw\`SELECT 1 FROM "routine" WHERE \${ownerFilter}\`;
       }
       export async function bar(db: unknown, u: string) { return db.$queryRaw\`SELECT 1 FROM "routine" WHERE \${foo(db, u)} IS NOT NULL\`; }`,
    );
    const rows = extractStatements([local]);
    const audit = parseAudit(writeAudit([], rows)).map((r) => ({ ...r, status: "ok", category: r.kind === "fragment" ? "fragment" : "user-filtered" }));
    const issues = sanityIssues(audit, rows);
    expect(issues.some((s) => s.includes("foo#2"))).toBe(false);
    expect(issues.some((s) => s.includes("bar#1"))).toBe(true);
  });
});

describe("AC21 — category sanity over fixtures (final review #4)", () => {
  const FRAG = src(
    "src/repositories/f.ts",
    `export const ROUTINES = (where: unknown) => Prisma.sql\`SELECT r.id FROM "routine" r WHERE \${where}\`;
     export async function all(db: unknown) { return db.$queryRaw(ROUTINES(Prisma.sql\`TRUE\`)); }
     export async function own(db: unknown, u: string) { return db.$queryRaw(ROUTINES(Prisma.sql\`r.user_id = \${u}::uuid\`)); }
     export async function me(prisma: unknown, id: string) { return prisma.user.findUnique({ where: { id } }); }`,
  );
  const rows = extractStatements([FRAG]);
  const audit = (cats: Record<string, string>) =>
    parseAudit(writeAudit([], rows)).map((r) => ({ ...r, status: "ok", category: cats[r.key.split("#")[1]!] ?? "fragment" }));

  it("refuses a user-filtered claim with no user predicate, and an anchored claim with no anchor", () => {
    expect(sanityIssues(audit({ all: "user-filtered", own: "user-filtered", me: "user-filtered" }), rows)).toEqual([
      // `all` names no user: its user-filtered claim is refused.
      expect.stringContaining("src/repositories/f.ts#all#1"),
    ]);
    expect(sanityIssues(audit({ own: "user-filtered", me: "user-filtered", all: "anchored" }), rows).some((s) => s.includes("all#1"))).toBe(true);
  });

  it("a shared-on-purpose row whose tables come from a fragment it calls is refused", () => {
    const issues = sanityIssues(audit({ all: "shared on purpose", own: "user-filtered", me: "user-filtered" }), rows);
    expect(issues.some((s) => s.includes("all#1") && s.includes("shared"))).toBe(true);
  });

  it("Spec 21.1 — Postgres's own catalogs (pg_*) are not user data: shared on purpose is allowed, but not with an owned table beside them", () => {
    const CATALOG = src(
      "src/db/c.ts",
      `export async function roles(db: unknown) { return db.$queryRaw\`SELECT rolname FROM pg_roles WHERE rolname = 'sin_app'\`; }
       export async function mixed(db: unknown) { return db.$queryRaw\`SELECT r.rolname FROM pg_roles r JOIN "workout" w ON TRUE\`; }`,
    );
    const catalogRows = extractStatements([CATALOG]);
    const shared = parseAudit(writeAudit([], catalogRows)).map((r) => ({ ...r, status: "ok", category: "shared on purpose" }));
    const issues = sanityIssues(shared, catalogRows);
    expect(issues.some((s) => s.includes("roles#1"))).toBe(false);
    expect(issues.some((s) => s.includes("mixed#1") && s.includes("shared"))).toBe(true);
  });

  it("a model-delegate call on an owned table is not shared on purpose", () => {
    const issues = sanityIssues(audit({ all: "user-filtered", own: "user-filtered", me: "shared on purpose" }), rows);
    expect(issues.some((s) => s.includes("me#1") && s.includes("shared"))).toBe(true);
  });

  it("a user model call keyed by id is user-filtered (self)", () => {
    const issues = sanityIssues(audit({ all: "user-filtered", own: "user-filtered", me: "user-filtered" }), rows);
    expect(issues.some((s) => s.includes("me#1"))).toBe(false);
  });
});

describe("AC30 — served code never imports the scripts", () => {
  it("no file under apps/api/src imports from apps/api/scripts", () => {
    const root = fileURLToPath(new URL("../../src", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => /from\s+["'][^"']*\/scripts\//.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });
});

describe("UNSAFE_ALLOWLIST", () => {
  it("every entry carries a reason", () => {
    for (const [key, reason] of Object.entries(UNSAFE_ALLOWLIST)) expect(reason.trim(), key).not.toBe("");
  });
});

describe("the real audit — docs/security/query-audit.md against apps/api/src", () => {
  const extracted = extractStatements(readSources());
  const rows = parseAudit(readFileSync(AUDIT_PATH, "utf8"));

  it("AC18, AC20, AC28 — every statement has exactly one current, classified row (the staleness check, run by the unit job)", () => {
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(checkAudit(extracted, rows, UNSAFE_ALLOWLIST)).toEqual([]);
  });

  it("AC21 — every row passes the category sanity checks (sanityIssues)", () => {
    expect(sanityIssues(rows, extracted)).toEqual([]);
  });

  it("AC31 — the header counts every category and lists every anchored statement with its anchor", () => {
    const md = readFileSync(AUDIT_PATH, "utf8");
    expect(md).toMatch(/^\d+ statements: /m);
    for (const r of rows.filter((x) => x.category === "anchored")) expect(md).toContain(`- \`${r.key}\` relies on \`${r.anchor.replace(/`/g, "")}\``);
  });
});

describe("MODEL_DELEGATES", () => {
  it("names exactly the Prisma schema's models, camel-cased", () => {
    const schema = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");
    const models = [...schema.matchAll(/^model (\w+)/gm)].map((m) => m[1]![0]!.toLowerCase() + m[1]!.slice(1));
    expect([...MODEL_DELEGATES].sort()).toEqual(models.sort());
  });
});
