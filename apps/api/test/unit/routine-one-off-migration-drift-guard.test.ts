import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../prisma/migrations/0013_routine_one_off/migration.sql", import.meta.url), "utf8");

describe("09.3 AC26 — migration 0013 is the spec §4 SQL", () => {
  it("adds the nullable expiry column", () => {
    expect(sql).toContain(`"one_off_until" TIMESTAMPTZ(6)`);
  });
  it("the CHECK keeps an expiry after creation", () => {
    expect(sql).toContain(`CONSTRAINT "routine_one_off_until_check"`);
    expect(sql).toContain(`CHECK ("one_off_until" IS NULL OR "one_off_until" > "created_at")`);
  });
});
