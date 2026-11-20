-- Spec 07.5 Phase B — 0022_reps_at_weight. Additive, expand-only; a manual release step before the code.
--
-- A new record type, `max_reps_at_weight`: most reps at one exact canonical-kg weight, one row per weight
-- (storage design A, D5). `at_weight_kg` is that weight, NULL for the seven older types. The key widens from
-- (user, root, type) to (user, root, type, weight) with NULLS NOT DISTINCT, so the older types stay one row per
-- root. The new index is created before the old one is dropped, so the table is never without a uniqueness rule.
-- The old statements (delete by root, then a seven-type INSERT) never name the index, so a release running
-- before the code is unaffected (AC15, AC32). No backfill: `records:rebuild` fills the new rows (runbook B5a).
-- The type and type↔unit CHECKs are rewritten the `0015` way; `unit` already allows 'reps'.
ALTER TABLE "personal_record" ADD COLUMN "at_weight_kg" NUMERIC(7,3);

ALTER TABLE "personal_record" DROP CONSTRAINT "personal_record_record_type_check";
ALTER TABLE "personal_record" DROP CONSTRAINT "personal_record_type_unit_check";
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_record_type_check" CHECK ("record_type" IN ('heaviest_weight', 'best_est_1rm', 'best_set_volume', 'max_reps', 'max_calories', 'max_distance', 'max_duration', 'max_reps_at_weight'));
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_type_unit_check" CHECK (
       ("record_type" = 'heaviest_weight' AND "unit" = 'kg')
    OR ("record_type" = 'best_est_1rm' AND "unit" = 'kg')
    OR ("record_type" = 'best_set_volume' AND "unit" = 'kg_reps')
    OR ("record_type" = 'max_reps' AND "unit" = 'reps')
    OR ("record_type" = 'max_calories' AND "unit" = 'cal')
    OR ("record_type" = 'max_distance' AND "unit" = 'm')
    OR ("record_type" = 'max_duration' AND "unit" = 's')
    OR ("record_type" = 'max_reps_at_weight' AND "unit" = 'reps'));
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_at_weight_check" CHECK (
    ("record_type" = 'max_reps_at_weight') = ("at_weight_kg" IS NOT NULL) AND ("at_weight_kg" IS NULL OR "at_weight_kg" > 0));

CREATE UNIQUE INDEX "personal_record_user_exercise_type_weight_key"
    ON "personal_record" ("user_id", "exercise_id", "record_type", "at_weight_kg") NULLS NOT DISTINCT;
DROP INDEX "personal_record_user_exercise_type_key";
