import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../prisma/migrations/0014_workout_section_origin/migration.sql", import.meta.url), "utf8");
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("09.4 AC17 — migration 0014 is the spec §4 SQL", () => {
  it("adds the NOT NULL DEFAULT false origin column", () => {
    expect(statements).toContain(`ALTER TABLE "workout_section"`);
    expect(statements).toContain(`ADD COLUMN "added_in_workout" BOOLEAN NOT NULL DEFAULT false`);
  });
  it("adds no table, index or constraint and drops nothing", () => {
    expect(statements).not.toMatch(/\b(CREATE|DROP|INDEX|CONSTRAINT)\b/);
  });
});
