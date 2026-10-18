-- Spec 07.4 §4 — additive, expand-only. Down = test teardown / local reset only.
ALTER TABLE "workout" ADD COLUMN "planned_duration_s" INTEGER;
ALTER TABLE "workout" ADD CONSTRAINT "workout_planned_duration_range"
  CHECK ("planned_duration_s" IS NULL OR ("planned_duration_s" >= 0 AND "planned_duration_s" <= 86400));
-- Only a live workout carries a plan; finishing clears it in the same UPDATE (§6.5).
ALTER TABLE "workout" ADD CONSTRAINT "workout_planned_duration_live_only"
  CHECK ("planned_duration_s" IS NULL OR "ended_at" IS NULL);
