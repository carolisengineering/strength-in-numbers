import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// Describes migration history; the live list is guarded against 0015 (Spec 05.3 D14).
const LEGACY_MODALITIES = ["weight_reps", "bodyweight_reps", "weighted_bodyweight", "duration", "distance_duration"] as const;

/**
 * AC2 drift-guard (Spec 03.1 §10). The `modality` CHECK in
 * `0002_create_exercise_catalog` is a second copy of `@sin/core` `LEGACY_MODALITIES`
 * — a vocabulary change that forgets the migration must fail here. This is a
 * string-containment check on the `.sql` file, *not* a parse of
 * `pg_get_constraintdef()` (Postgres rewrites `IN (...)` to `= ANY (ARRAY[...])`,
 * so a parse would be brittle). The behavioural half of AC2 — a bad value is
 * rejected, every valid value is accepted — is the integration suite.
 */
const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/0002_create_exercise_catalog/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("AC2 — modality CHECK cannot silently drift from @sin/core", () => {
  it("renders the exact LEGACY_MODALITIES list, in order, in the CHECK clause", () => {
    const rendered = LEGACY_MODALITIES.map((v) => `'${v}'`).join(", ");
    expect(migrationSql).toContain(`"modality" IN (${rendered})`);
  });

  it("names every modality value somewhere in the CHECK", () => {
    for (const value of LEGACY_MODALITIES) {
      expect(migrationSql).toContain(`'${value}'`);
    }
  });

  it("keeps the constraint on the exercise table under a stable name", () => {
    expect(migrationSql).toContain(
      'CONSTRAINT "exercise_modality_check" CHECK ("modality" IN (',
    );
  });
});
