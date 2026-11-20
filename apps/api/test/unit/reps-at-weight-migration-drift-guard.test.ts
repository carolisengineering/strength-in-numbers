import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECORD_TYPE_VALUES, RECORD_UNIT_BY_TYPE } from "@sin/core";

/** Spec 07.5 AC17: 0022 rewrites the record-type and type↔unit CHECKs, so the live @sin/core lists are guarded
 * here (0015's guard is frozen to its seven types). */
const sql = readFileSync(new URL("../../prisma/migrations/0022_reps_at_weight/migration.sql", import.meta.url), "utf8");
const render = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

describe("07.5 AC17 — 0022's CHECKs render the live @sin/core lists", () => {
  it("renders RECORD_TYPE_VALUES in the record-type CHECK", () => {
    expect(sql).toContain(`"record_type" IN (${render(RECORD_TYPE_VALUES)})`);
  });
  it("renders one type↔unit clause per RECORD_UNIT_BY_TYPE entry, and no other", () => {
    for (const [type, unit] of Object.entries(RECORD_UNIT_BY_TYPE)) {
      expect(sql).toContain(`("record_type" = '${type}' AND "unit" = '${unit}')`);
    }
    expect(sql.match(/\("record_type" = '[a-z0-9_]+' AND "unit" = '[a-z0-9_]+'\)/g)).toHaveLength(Object.keys(RECORD_UNIT_BY_TYPE).length);
  });
  it("the at-weight CHECK ties the weight to the new type", () => {
    expect(sql).toContain(`("record_type" = 'max_reps_at_weight') = ("at_weight_kg" IS NOT NULL) AND ("at_weight_kg" IS NULL OR "at_weight_kg" > 0)`);
  });
  it("the key is created with NULLS NOT DISTINCT before the old one is dropped", () => {
    const create = sql.indexOf(`CREATE UNIQUE INDEX "personal_record_user_exercise_type_weight_key"`);
    const drop = sql.indexOf(`DROP INDEX "personal_record_user_exercise_type_key"`);
    expect(create).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(create);
    expect(sql).toMatch(/\("user_id", "exercise_id", "record_type", "at_weight_kg"\) NULLS NOT DISTINCT;/);
  });
});
