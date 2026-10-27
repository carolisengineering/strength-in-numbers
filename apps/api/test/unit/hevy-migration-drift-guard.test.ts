import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HEVY_LINK_ORIGIN_VALUES,
  HEVY_TYPE_VALUES,
  MEASURE_RULE_VALUES,
  PAIR_ROLE_VALUES,
  SECTION_TREATMENT_VALUES,
  WORKOUT_SOURCE_VALUES,
} from "@sin/core";

// The live lists are guarded here (0016); 0005's guard keeps the frozen ['manual'] (Spec 19.0 AC20).
const sql = readFileSync(new URL("../../prisma/migrations/0016_hevy_integration/migration.sql", import.meta.url), "utf8");
const render = (xs: readonly string[]) => xs.map((v) => `'${v}'`).join(", ");

describe("19.0 AC20 — 0016 renders the live lists", () => {
  it.each([
    ["source", WORKOUT_SOURCE_VALUES],
    ["hevy_type", HEVY_TYPE_VALUES],
    ["role", PAIR_ROLE_VALUES],
    ["measure_rule", MEASURE_RULE_VALUES],
    ["treatment", SECTION_TREATMENT_VALUES],
    ["origin", HEVY_LINK_ORIGIN_VALUES],
  ] as const)("%s", (column, values) => {
    expect(sql).toContain(`"${column}" IN (${render(values)})`);
  });

  it("has no data statement", () => {
    // A statement starts a line; `ON UPDATE CASCADE` on a foreign key is not one.
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\b/im);
  });
});
