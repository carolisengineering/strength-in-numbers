import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DISTANCE_UNIT_VALUES,
  FT_TO_M,
  KM_TO_M,
  MI_TO_M,
  MODALITY_VALUES,
  RECORD_TYPE_VALUES,
  RECORD_UNIT_BY_TYPE,
  RECORD_UNIT_VALUES,
} from "@sin/core";

/** Spec 05.3 AC17 / AC40: 0015 widens every CHECK that lists a vocabulary, so the
 * live @sin/core lists are guarded here (the 0002 / 0005 / 0006 / 0008 guards are frozen). */
const sql = readFileSync(
  new URL("../../prisma/migrations/0015_new_exercise_modalities/migration.sql", import.meta.url),
  "utf8",
);
const render = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
const CONVERSION: Record<(typeof DISTANCE_UNIT_VALUES)[number], string> = {
  m: `THEN "distance"\n`,
  km: `THEN "distance" * ${KM_TO_M}`,
  mi: `THEN "distance" * ${MI_TO_M}`,
  ft: `THEN "distance" * ${FT_TO_M}`,
};

describe("05.3 AC17 — 0015's CHECKs render the live @sin/core lists", () => {
  it("renders MODALITY_VALUES in both modality CHECKs", () => {
    expect(sql).toContain(`"modality" IN (${render(MODALITY_VALUES)})`);
    expect(sql).toContain(`"modality_snapshot" IN (${render(MODALITY_VALUES)})`);
  });
  it("renders RECORD_TYPE_VALUES and RECORD_UNIT_VALUES", () => {
    expect(sql).toContain(`"record_type" IN (${render(RECORD_TYPE_VALUES)})`);
    expect(sql).toContain(`"unit" IN (${render(RECORD_UNIT_VALUES)})`);
  });
  it("renders one type↔unit clause per RECORD_UNIT_BY_TYPE entry", () => {
    for (const [type, unit] of Object.entries(RECORD_UNIT_BY_TYPE)) {
      expect(sql).toContain(`("record_type" = '${type}' AND "unit" = '${unit}')`);
    }
  });
  it("widens both value columns to NUMERIC(14,3) (D8)", () => {
    expect(sql).toContain(`ALTER COLUMN "value" TYPE NUMERIC(14,3)`);
    expect(sql).toContain(`ALTER COLUMN "previous_value" TYPE NUMERIC(14,3)`);
  });
});

describe("05.3 AC40 — 0015's distance unit CHECK and distance_m rebuild render the live units", () => {
  it("renders DISTANCE_UNIT_VALUES in the distance unit CHECK", () => {
    expect(sql).toContain(`"distance_unit" IN (${render(DISTANCE_UNIT_VALUES)})`);
  });
  const expr = sql.slice(sql.indexOf(`ADD COLUMN "distance_m"`), sql.indexOf("STORED;"));
  it("has one WHEN arm per unit, with the @sin/core conversion constant", () => {
    for (const unit of DISTANCE_UNIT_VALUES) {
      expect(expr).toContain(`WHEN "distance_unit" = '${unit}'`);
      expect(expr.replace(/ +/g, " ")).toContain(CONVERSION[unit].replace(/ +/g, " "));
    }
    expect(expr.match(/WHEN "distance_unit" =/g)).toHaveLength(DISTANCE_UNIT_VALUES.length);
  });
  it("has no catch-all arm and the DROP has no CASCADE", () => {
    expect(expr).not.toMatch(/\bELSE\b/);
    expect(sql).toContain(`DROP COLUMN "distance_m";`);
    expect(sql).not.toMatch(/DROP COLUMN "distance_m"[^;]*CASCADE/i);
  });
});
