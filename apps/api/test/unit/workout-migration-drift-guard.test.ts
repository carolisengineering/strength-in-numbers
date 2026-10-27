import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// Describes migration history; the live list is guarded against 0015 (Spec 05.3 D14).
const LEGACY_MODALITIES = ["weight_reps", "bodyweight_reps", "weighted_bodyweight", "duration", "distance_duration"] as const;

// Describes migration history; the live list is guarded against 0016 (Spec 19.0 AC20).
const LEGACY_WORKOUT_SOURCES = ["manual"] as const;

const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/0005_create_workout_session/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("AC2 — both CHECK literal lists cannot silently drift from @sin/core", () => {
  it("renders the frozen legacy source list verbatim in the workout.source CHECK", () => {
    const rendered = LEGACY_WORKOUT_SOURCES.map((v) => `'${v}'`).join(", ");
    expect(migrationSql).toContain(`"source" IN (${rendered})`);
  });

  it("renders the frozen legacy modality list verbatim in the workout_exercise.modality_snapshot CHECK", () => {
    const rendered = LEGACY_MODALITIES.map((v) => `'${v}'`).join(", ");
    expect(migrationSql).toContain(`"modality_snapshot" IN (${rendered})`);
  });
});
