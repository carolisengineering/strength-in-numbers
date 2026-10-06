import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECORD_TYPE_VALUES, RECORD_UNIT_BY_TYPE, RECORD_UNIT_VALUES } from "@sin/core";

const sql = readFileSync(
  new URL("../../prisma/migrations/0008_create_personal_record/migration.sql", import.meta.url),
  "utf8",
);
const render = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

describe("AC2 — personal_record's CHECK lists cannot silently drift from @sin/core", () => {
  it("renders RECORD_TYPE_VALUES and RECORD_UNIT_VALUES verbatim", () => {
    expect(sql).toContain(`"record_type" IN (${render(RECORD_TYPE_VALUES)})`);
    expect(sql).toContain(`"unit" IN (${render(RECORD_UNIT_VALUES)})`);
  });
  it("renders one type↔unit clause per RECORD_UNIT_BY_TYPE entry", () => {
    for (const [type, unit] of Object.entries(RECORD_UNIT_BY_TYPE)) {
      expect(sql).toContain(`("record_type" = '${type}' AND "unit" = '${unit}')`);
    }
  });
  it("value columns are numeric(12,3) (D4)", () => {
    expect(sql).toContain(`"value" NUMERIC(12,3) NOT NULL`);
    expect(sql).toContain(`"previous_value" NUMERIC(12,3)`);
  });
});
