-- Spec 05.3 §4 — 0015_new_exercise_modalities. Additive, expand-only.
-- Down (dev/test teardown only; production undo is `git revert` + a forward migration):
--   ALTER TABLE "set_entry" DROP CONSTRAINT "set_entry_calories_check";
--   ALTER TABLE "set_entry" DROP COLUMN "calories";
--   (the widened CHECKs, NUMERIC(14,3) and the rebuilt distance_m may stay; see §11 for the rows that block a code rollback)
-- Each IN (...) list is on one line: the drift guard (new-modalities-migration-drift-guard.test.ts) renders them.

ALTER TABLE "set_entry" ADD COLUMN "calories" SMALLINT;
ALTER TABLE "set_entry" ADD CONSTRAINT "set_entry_calories_check"
    CHECK ("calories" IS NULL OR "calories" >= 0);

-- Feet (O4, D18). The CHECK alone is NOT enough: 0006's expression ends in `ELSE distance * 1609.344`,
-- so an 'ft' row would be computed as miles. Postgres 16 has no ALTER COLUMN ... SET EXPRESSION
-- (that is PG17), so the generated column is dropped and re-added, in this transaction, with every
-- unit named and no catch-all. No cascade: if anything depended on distance_m the DROP would fail.
ALTER TABLE "set_entry" DROP CONSTRAINT "set_entry_distance_unit_check";
ALTER TABLE "set_entry" ADD CONSTRAINT "set_entry_distance_unit_check"
    CHECK ("distance_unit" IN ('m', 'km', 'mi', 'ft') OR "distance_unit" IS NULL);
ALTER TABLE "set_entry" DROP COLUMN "distance_m";
ALTER TABLE "set_entry" ADD COLUMN "distance_m" NUMERIC(9,3) GENERATED ALWAYS AS (
    CASE WHEN "distance" IS NULL THEN NULL
         WHEN "distance_unit" = 'm'  THEN "distance"
         WHEN "distance_unit" = 'km' THEN "distance" * 1000
         WHEN "distance_unit" = 'mi' THEN "distance" * 1609.344
         WHEN "distance_unit" = 'ft' THEN "distance" * 0.3048
    END) STORED;

ALTER TABLE "exercise" DROP CONSTRAINT "exercise_modality_check";
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_modality_check" CHECK ("modality" IN ('weight_reps', 'bodyweight_reps', 'weighted_bodyweight', 'duration', 'distance_duration', 'calories', 'weight_distance', 'weight_duration'));

ALTER TABLE "workout_exercise" DROP CONSTRAINT "workout_exercise_modality_snapshot_check";
ALTER TABLE "workout_exercise" ADD CONSTRAINT "workout_exercise_modality_snapshot_check" CHECK ("modality_snapshot" IN ('weight_reps', 'bodyweight_reps', 'weighted_bodyweight', 'duration', 'distance_duration', 'calories', 'weight_distance', 'weight_duration'));

ALTER TABLE "personal_record" DROP CONSTRAINT "personal_record_record_type_check";
ALTER TABLE "personal_record" DROP CONSTRAINT "personal_record_unit_check";
ALTER TABLE "personal_record" DROP CONSTRAINT "personal_record_type_unit_check";
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_record_type_check" CHECK ("record_type" IN ('heaviest_weight', 'best_est_1rm', 'best_set_volume', 'max_reps', 'max_calories', 'max_distance', 'max_duration'));
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_unit_check" CHECK ("unit" IN ('kg', 'kg_reps', 'reps', 'cal', 'm', 's'));
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_type_unit_check" CHECK (
       ("record_type" = 'heaviest_weight' AND "unit" = 'kg')
    OR ("record_type" = 'best_est_1rm' AND "unit" = 'kg')
    OR ("record_type" = 'best_set_volume' AND "unit" = 'kg_reps')
    OR ("record_type" = 'max_reps' AND "unit" = 'reps')
    OR ("record_type" = 'max_calories' AND "unit" = 'cal')
    OR ("record_type" = 'max_distance' AND "unit" = 'm')
    OR ("record_type" = 'max_duration' AND "unit" = 's'));
ALTER TABLE "personal_record"
    ALTER COLUMN "value" TYPE NUMERIC(14,3),
    ALTER COLUMN "previous_value" TYPE NUMERIC(14,3);
