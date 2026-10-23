-- Spec 09.4 §4 — 0014_workout_section_origin. Additive, expand-only.
-- Down (dev/test teardown only; production undo is `git revert` + a forward migration):
--   ALTER TABLE "workout_section" DROP COLUMN "added_in_workout";

ALTER TABLE "workout_section"
    ADD COLUMN "added_in_workout" BOOLEAN NOT NULL DEFAULT false;
