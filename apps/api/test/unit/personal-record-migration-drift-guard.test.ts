import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// Describes migration history; the live list is guarded against 0015 (Spec 05.3 D14).
const LEGACY_RECORD_TYPES = ["heaviest_weight", "best_est_1rm", "best_set_volume", "max_reps"] as const;
const LEGACY_UNITS = ["kg", "kg_reps", "reps"] as const;
const LEGACY_UNIT_BY_TYPE = { heaviest_weight: "kg", best_est_1rm: "kg", best_set_volume: "kg_reps", max_reps: "reps" } as const;

const sql = readFileSync(
  new URL("../../prisma/migrations/0008_create_personal_record/migration.sql", import.meta.url),
  "utf8",
);
const render = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

describe("AC2 — personal_record's CHECK lists cannot silently drift from @sin/core", () => {
  it("renders the frozen legacy type and unit lists verbatim", () => {
    expect(sql).toContain(`"record_type" IN (${render(LEGACY_RECORD_TYPES)})`);
    expect(sql).toContain(`"unit" IN (${render(LEGACY_UNITS)})`);
  });
  it("renders one type↔unit clause per legacy pair", () => {
    for (const [type, unit] of Object.entries(LEGACY_UNIT_BY_TYPE)) {
      expect(sql).toContain(`("record_type" = '${type}' AND "unit" = '${unit}')`);
    }
  });
  it("value columns are numeric(12,3) (D4)", () => {
    expect(sql).toContain(`"value" NUMERIC(12,3) NOT NULL`);
    expect(sql).toContain(`"previous_value" NUMERIC(12,3)`);
  });
});
