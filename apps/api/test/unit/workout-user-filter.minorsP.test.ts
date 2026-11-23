import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Minor 392 — the three workout UPDATEs by id (`updateWorkout#2`, `finishedPatch#1`, `insertFromRoutine#7`) filter by
 * user too. Each runs after a user-filtered lock or insert in the same transaction, so the repository can't drive one
 * with another user's id (its preflight refuses first); the pin is on the SQL text, as the plan allows.
 */
describe("minor 392 — every workout UPDATE in workout.prisma.ts filters by user (SQL text: unreachable with a foreign user)", () => {
  const source = readFileSync(new URL("../../src/repositories/workout.prisma.ts", import.meta.url), "utf8");
  const statements = [...source.matchAll(/UPDATE "workout"[\s\S]*?WHERE ([^\n]*)/g)].map((m) => m[1]!.trim());

  it("finds the three statements", () => {
    expect(statements).toHaveLength(3);
  });

  it("each WHERE carries AND user_id = <the acting user>", () => {
    for (const where of statements) expect(where).toMatch(/^id = \$\{[\w.]+\}::uuid AND user_id = \$\{(actingUserId|userId)\}::uuid$/);
  });
});

describe("minor 409 — the export maps the user with the one user mapper", () => {
  const exportSource = readFileSync(new URL("../../src/repositories/account-export.prisma.ts", import.meta.url), "utf8");
  const userSource = readFileSync(new URL("../../src/repositories/user.prisma.ts", import.meta.url), "utf8");

  it("the export reads the user row through USER_COLUMNS and maps it with fromRow, not a model call", () => {
    expect(exportSource).toMatch(/SELECT \$\{USER_COLUMNS\} FROM "user" WHERE id = \$\{userId\}::uuid/);
    expect(exportSource).toContain("fromRow(");
    expect(exportSource).not.toMatch(/tx\.user\./);
  });

  it("user.prisma.ts has one mapper: toRecord / toUserRecord are gone", () => {
    expect(userSource).not.toMatch(/function toRecord\b|toUserRecord/);
  });
});
