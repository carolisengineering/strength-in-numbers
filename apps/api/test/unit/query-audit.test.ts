import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  UNSAFE_ALLOWLIST,
  checkAudit,
  extractStatements,
  fingerprint,
  parseAudit,
  writeAudit,
  type Source,
} from "../../scripts/lib/query-extract.js";

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
  it("collapses whitespace and turns a value ${…} into ?", () => {
    expect(fingerprint("SELECT  id\n FROM t WHERE id = ${id}::uuid")).toBe(fingerprint("SELECT id FROM t WHERE id = ${other}::uuid"));
  });

  it("keeps a ${…} that composes SQL, so swapping a predicate fragment changes it", () => {
    expect(fingerprint("DELETE FROM t WHERE id = ${id}::uuid AND ${ownedSet(u, Prisma.sql`t.id`)}")).not.toBe(
      fingerprint("DELETE FROM t WHERE id = ${id}::uuid AND ${Prisma.empty}"),
    );
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
