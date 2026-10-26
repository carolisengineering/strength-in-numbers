import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KM_TO_M,
  LB_TO_KG,
  MI_TO_M,
  SET_TYPE_VALUES,
  WEIGHT_UNIT_VALUES,
} from "@sin/core";

// The 0006 distance-unit list describes history; the live list is guarded against 0015 (Spec 05.3 D14, AC17).
const LEGACY_DISTANCE_UNITS = ["m", "km", "mi"] as const;

const migrationSql = readFileSync(
  new URL("../../prisma/migrations/0006_create_set_entry/migration.sql", import.meta.url),
  "utf8",
);
const render = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

describe("AC2 — set_entry's CHECK literal lists cannot silently drift from @sin/core", () => {
  it("renders SET_TYPE_VALUES verbatim in the set_type CHECK", () => {
    expect(migrationSql).toContain(`"set_type" IN (${render(SET_TYPE_VALUES)})`);
  });
  it("renders WEIGHT_UNIT_VALUES and the frozen legacy distance units verbatim in the unit CHECKs", () => {
    expect(migrationSql).toContain(`"weight_unit" IN (${render(WEIGHT_UNIT_VALUES)})`);
    expect(migrationSql).toContain(`"distance_unit" IN (${render(LEGACY_DISTANCE_UNITS)})`);
  });
});

describe("§4 — generated columns reuse @sin/core's conversion constants verbatim (DESIGN §4.8, R4)", () => {
  it("weight_kg multiplies by LB_TO_KG; distance_m by KM_TO_M and MI_TO_M", () => {
    expect(migrationSql).toContain(`"weight" * ${LB_TO_KG}`);
    expect(migrationSql).toContain(`"distance" * ${KM_TO_M}`);
    expect(migrationSql).toContain(`"distance" * ${MI_TO_M}`);
  });
});
