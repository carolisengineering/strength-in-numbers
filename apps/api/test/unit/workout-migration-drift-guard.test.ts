import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODALITY_VALUES, WORKOUT_SOURCE_VALUES } from "@sin/core";

const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/0005_create_workout_session/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("AC2 — both CHECK literal lists cannot silently drift from @sin/core", () => {
  it("renders WORKOUT_SOURCE_VALUES verbatim in the workout.source CHECK", () => {
    const rendered = WORKOUT_SOURCE_VALUES.map((v) => `'${v}'`).join(", ");
    expect(migrationSql).toContain(`"source" IN (${rendered})`);
  });

  it("renders MODALITY_VALUES verbatim in the workout_exercise.modality_snapshot CHECK", () => {
    const rendered = MODALITY_VALUES.map((v) => `'${v}'`).join(", ");
    expect(migrationSql).toContain(`"modality_snapshot" IN (${rendered})`);
  });
});
