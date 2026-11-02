-- Spec 09.5 §4 — 0018_timed_sections. Additive, expand-only: nullable plan and result columns, one
-- NOT NULL DEFAULT false flag (metadata-only), two CHECK scans over small tables, one new table. No backfill.
-- A manual release step before the code (runbook "0018"). The cross-row round rules (strictly increasing,
-- within the cap or round length) are the handler's under the section row lock; assertSectionsConsistent
-- is their test-side guard (AC34).
-- Each OR-shaped CHECK is wrapped in COALESCE(…, false): a CHECK passes when its expression is NULL, and
-- `NULL BETWEEN 1 AND 100` or `NULL = 'amrap'` is NULL, which would let a missing plan number or a result
-- on an untimed section through (found while building Phase A; spec §4 amended).
-- Down (dev/test teardown only; production undo is `git revert` + a forward migration):
--   DROP TABLE "workout_section_round";
--   ALTER TABLE "workout_section" DROP CONSTRAINT "workout_section_result_shape_check", DROP CONSTRAINT "workout_section_result_range_check",
--     DROP CONSTRAINT "workout_section_timer_check", DROP COLUMN "result_capped", DROP COLUMN "result_finish_s", DROP COLUMN "result_reps",
--     DROP COLUMN "result_rounds", DROP COLUMN "timer_cap_s", DROP COLUMN "timer_rounds", DROP COLUMN "timer_round_s", DROP COLUMN "timer_format";
--   ALTER TABLE "routine_section" DROP CONSTRAINT "routine_section_timer_check", DROP COLUMN "timer_cap_s", DROP COLUMN "timer_rounds",
--     DROP COLUMN "timer_round_s", DROP COLUMN "timer_format";

ALTER TABLE "routine_section"
    ADD COLUMN "timer_format"  TEXT,
    ADD COLUMN "timer_round_s" INTEGER,   -- Set Timer: the round length
    ADD COLUMN "timer_rounds"  SMALLINT,  -- Set Timer: the number of rounds
    ADD COLUMN "timer_cap_s"   INTEGER,   -- AMRAP: the time limit; Time Cap: the cap (NULL = "For Time")
    ADD CONSTRAINT "routine_section_timer_check" CHECK (COALESCE((
        ("timer_format" IS NULL     AND "timer_round_s" IS NULL AND "timer_rounds" IS NULL AND "timer_cap_s" IS NULL)
     OR ("timer_format" = 'set_timer' AND "timer_round_s" BETWEEN 1 AND 3600 AND "timer_rounds" BETWEEN 1 AND 100 AND "timer_cap_s" IS NULL)
     OR ("timer_format" = 'amrap'     AND "timer_cap_s" BETWEEN 1 AND 10800 AND "timer_round_s" IS NULL AND "timer_rounds" IS NULL)
     OR ("timer_format" = 'time_cap'  AND ("timer_cap_s" IS NULL OR "timer_cap_s" BETWEEN 1 AND 10800) AND "timer_round_s" IS NULL AND "timer_rounds" IS NULL)), false));

ALTER TABLE "workout_section"
    ADD COLUMN "timer_format"    TEXT,
    ADD COLUMN "timer_round_s"   INTEGER,
    ADD COLUMN "timer_rounds"    SMALLINT,
    ADD COLUMN "timer_cap_s"     INTEGER,
    ADD COLUMN "result_rounds"   SMALLINT,                          -- AMRAP rounds; Time Cap (capped) rounds reached
    ADD COLUMN "result_reps"     SMALLINT,                          -- AMRAP reps into the next round; Time Cap (capped) reps
    ADD COLUMN "result_finish_s" INTEGER,                           -- Time Cap: the finish time
    ADD COLUMN "result_capped"   BOOLEAN NOT NULL DEFAULT false,    -- Time Cap: the cap was hit
    ADD CONSTRAINT "workout_section_timer_check" CHECK (COALESCE((
        ("timer_format" IS NULL     AND "timer_round_s" IS NULL AND "timer_rounds" IS NULL AND "timer_cap_s" IS NULL)
     OR ("timer_format" = 'set_timer' AND "timer_round_s" BETWEEN 1 AND 3600 AND "timer_rounds" BETWEEN 1 AND 100 AND "timer_cap_s" IS NULL)
     OR ("timer_format" = 'amrap'     AND "timer_cap_s" BETWEEN 1 AND 10800 AND "timer_round_s" IS NULL AND "timer_rounds" IS NULL)
     OR ("timer_format" = 'time_cap'  AND ("timer_cap_s" IS NULL OR "timer_cap_s" BETWEEN 1 AND 10800) AND "timer_round_s" IS NULL AND "timer_rounds" IS NULL)), false)),
    ADD CONSTRAINT "workout_section_result_range_check" CHECK (
        ("result_rounds" IS NULL OR "result_rounds" BETWEEN 0 AND 999)
    AND ("result_reps" IS NULL OR "result_reps" BETWEEN 0 AND 9999)
    AND ("result_finish_s" IS NULL OR "result_finish_s" BETWEEN 1 AND 10800)),
    ADD CONSTRAINT "workout_section_result_shape_check" CHECK (COALESCE((
        ("result_rounds" IS NULL AND "result_reps" IS NULL AND "result_finish_s" IS NULL AND NOT "result_capped")      -- nothing recorded: always legal
     OR ("timer_format" = 'amrap' AND "result_rounds" IS NOT NULL AND "result_reps" IS NOT NULL
         AND "result_finish_s" IS NULL AND NOT "result_capped")
     OR ("timer_format" = 'time_cap' AND NOT "result_capped" AND "result_finish_s" IS NOT NULL
         AND "result_rounds" IS NULL AND "result_reps" IS NULL
         AND ("timer_cap_s" IS NULL OR "result_finish_s" <= "timer_cap_s"))
     OR ("timer_format" = 'time_cap' AND "result_capped" AND "timer_cap_s" IS NOT NULL AND "result_finish_s" IS NULL
         AND ("result_rounds" IS NOT NULL OR "result_reps" IS NOT NULL))), false));

CREATE TABLE "workout_section_round" (
    "workout_section_id" UUID           NOT NULL,
    "round_no"           SMALLINT       NOT NULL,
    "seconds"            INTEGER        NOT NULL,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "workout_section_round_pkey" PRIMARY KEY ("workout_section_id", "round_no"),
    CONSTRAINT "workout_section_round_section_fkey" FOREIGN KEY ("workout_section_id") REFERENCES "workout_section"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workout_section_round_no_check" CHECK ("round_no" BETWEEN 1 AND 100),
    CONSTRAINT "workout_section_round_seconds_check" CHECK ("seconds" BETWEEN 1 AND 10800)
);
