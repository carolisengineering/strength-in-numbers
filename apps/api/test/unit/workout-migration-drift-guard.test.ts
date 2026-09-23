import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODALITY_VALUES } from "@sin/core";

const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/0005_create_workout_session/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("AC2 — both CHECK literal lists cannot silently drift from @sin/core", () => {
  // Task 1 writes this file (Spec 05.0 code-implementation plan); Task 3 lands
  // `WORKOUT_SOURCE_VALUES` as a named export of @sin/core and completes this
  // case (uncomment the import, replace the `it.todo` with the assertion
  // below). Left as `it.todo` rather than a live import so a not-yet-existing
  // named export doesn't fail `pnpm run typecheck` in the interim.
  //
  //   import { WORKOUT_SOURCE_VALUES } from "@sin/core";
  //   it("renders WORKOUT_SOURCE_VALUES verbatim in the workout.source CHECK", () => {
  //     const rendered = WORKOUT_SOURCE_VALUES.map((v) => `'${v}'`).join(", ");
  //     expect(migrationSql).toContain(`"source" IN (${rendered})`);
  //   });
  it.todo(
    "renders WORKOUT_SOURCE_VALUES verbatim in the workout.source CHECK (completed in Task 3)",
  );

  it("renders MODALITY_VALUES verbatim in the workout_exercise.modality_snapshot CHECK", () => {
    const rendered = MODALITY_VALUES.map((v) => `'${v}'`).join(", ");
    expect(migrationSql).toContain(`"modality_snapshot" IN (${rendered})`);
  });
});
