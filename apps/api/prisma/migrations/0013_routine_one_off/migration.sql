-- Spec 09.3 §4 — 0013_routine_one_off. Additive, expand-only.
-- Down (dev/test teardown only; production undo is `git revert` + a forward migration):
--   ALTER TABLE "routine" DROP CONSTRAINT "routine_one_off_until_check", DROP COLUMN "one_off_until";

ALTER TABLE "routine"
    ADD COLUMN "one_off_until" TIMESTAMPTZ(6),
    ADD CONSTRAINT "routine_one_off_until_check"
        CHECK ("one_off_until" IS NULL OR "one_off_until" > "created_at");
