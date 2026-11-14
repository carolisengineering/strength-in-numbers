import { describe, expect, it } from "vitest";
import { TRIPWIRE_ALLOWED, rawSqlSpellingIssues } from "../../scripts/lib/query-tripwire.js";
import { apiProgram, overlayPath, rel, srcFiles } from "./helpers/ts-program.js";

/**
 * Minor 393: the query audit's extractor reads syntax, so a statement spelled in a way it doesn't list would run with
 * no audit row. This tripwire refuses those spellings by type: a renamed client or a renamed `Prisma` is caught too.
 */

const FIXTURE = "src/repositories/tripwire-fixture.ts";
const HEAD = `import { Prisma, PrismaClient } from "@prisma/client";
declare const tx: Prisma.TransactionClient;
declare const values: Prisma.Sql[];
declare const parts: Prisma.Sql[];
declare const sep: string;
void values; void parts; void sep;
`;

const issuesFor = (body: string, head = HEAD): string[] =>
  rawSqlSpellingIssues(apiProgram([], { [FIXTURE]: head + body }), [overlayPath(FIXTURE)], rel);

describe("minor 393 — raw SQL only in spellings the audit lists", () => {
  it.each([
    ["a string-indexed raw method", "export const a = tx[\"$queryRaw\"]`SELECT 1`;\n", 1],
    ["a raw method destructured from a client", "const { $queryRaw: q } = tx;\nexport const a = q`SELECT 1`;\n", 1],
    [
      "a renamed Prisma import",
      "export const a = P.sql`SELECT 1`;\n",
      3,
      'import { Prisma as P } from "@prisma/client";\n',
    ],
    ["Prisma.sql saved to a variable", "export const sql = Prisma.sql;\n", 3],
    ["$queryRawTyped", "// @ts-ignore the audit doesn't support typed SQL, whatever the client's version\nexport const a = tx.$queryRawTyped({});\n", 2],
    ["a delegate destructured from a client", "const { workout } = tx;\nexport const a = workout.findMany();\n", 4],
    ["a Prisma.join separator that isn't a string literal", "export const a = Prisma.join(values, sep);\n", 3],
  ] as [string, string, number, string?][])("%s fails with rule %i", (_name, body, rule, head) => {
    const issues = issuesFor(body, head ?? HEAD);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(`rule ${rule}:`);
    expect(issues[0]).toMatch(/^src\/repositories\/tripwire-fixture\.ts:\d+ /);
  });

  it("a renamed client is still a client (Review Focus 3)", () => {
    const issues = issuesFor("const db = tx;\nexport const a = db[\"$queryRaw\"]`SELECT 1`;\n");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("rule 1:");
  });

  it("a namespace copied to a variable is still Prisma (Review Focus 3)", () => {
    const issues = issuesFor("const P = Prisma;\nexport const a = P.sql`SELECT 1`;\n");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("rule 3:");
  });

  it("a computed key that names a raw method is caught", () => {
    const issues = issuesFor('declare const m: "$queryRaw" | "$executeRaw";\nexport const a = tx[m];\n');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("rule 1:");
  });

  it("types that name the raw methods are not accesses (Review Focus 2)", () => {
    expect(
      issuesFor('export type T = PrismaClient["$transaction"];\nexport type R = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;\n'),
    ).toEqual([]);
  });

  it("the accepted spellings pass (Review Focus 1)", () => {
    expect(
      issuesFor(`export async function f() {
  await tx.$queryRaw\`SELECT 1\`;
  await tx.$executeRaw(Prisma.sql\`SELECT 1\`);
  const a = Prisma.sql\`SELECT 2\`;
  const b = Prisma.raw("x");
  const c = Prisma.join(values);
  const d = Prisma.join(parts, " ");
  await tx.workout.findMany();
  return [a, b, c, d];
}
`),
    ).toEqual([]);
  });

  it("src on main passes, outside the handle's two pass-throughs", () => {
    const files = srcFiles();
    expect(rawSqlSpellingIssues(apiProgram(files), files, rel)).toEqual([]);
  });

  it("each allowed pass-through still forwards a raw method (the list can't go stale)", () => {
    const files = srcFiles();
    const all = rawSqlSpellingIssues(apiProgram(files), files, rel, {});
    for (const key of Object.keys(TRIPWIRE_ALLOWED)) expect([key, all.some((i) => i.includes(`(${key})`))]).toEqual([key, true]);
  });
});
