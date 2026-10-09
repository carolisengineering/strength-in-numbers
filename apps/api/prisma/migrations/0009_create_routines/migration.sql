-- Spec 09 §4 — 0009_create_routines. Additive, expand-only.
-- Down = ALTER TABLE ... DROP COLUMN ...; DROP TABLE "routine_item", "routine";
-- (dev/test teardown only — production undo is `git revert` + a forward migration.)

CREATE TABLE "routine" (
    "id"          UUID           NOT NULL,
    "user_id"     UUID           NOT NULL,
    "name"        TEXT           NOT NULL,
    "notes"       TEXT,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "routine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routine_name_check" CHECK (char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name")),
    CONSTRAINT "routine_notes_check" CHECK ("notes" IS NULL OR char_length("notes") BETWEEN 1 AND 2000),
    CONSTRAINT "routine_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Per-user case-insensitive name uniqueness (also the lookup index for "my routines").
CREATE UNIQUE INDEX "routine_user_name_key" ON "routine" ("user_id", lower("name"));

CREATE TABLE "routine_item" (
    "id"               UUID           NOT NULL,
    "routine_id"       UUID           NOT NULL,
    "position"         SMALLINT       NOT NULL,
    "exercise_id"      UUID           NOT NULL,
    "target_sets"      SMALLINT,
    "target_reps_low"  SMALLINT,
    "target_reps_high" SMALLINT,
    "target_rpe"       SMALLINT,          -- tenths: 60..100, multiples of 5 (D5)
    "rest_seconds"     SMALLINT,
    "superset_group"   SMALLINT,
    "notes"            TEXT,
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "routine_item_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routine_item_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "routine_item_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "routine_item_position_check" CHECK ("position" >= 0),
    CONSTRAINT "routine_item_targets_check" CHECK (
        ("target_sets" IS NULL OR "target_sets" BETWEEN 1 AND 20)
        AND (("target_reps_low" IS NULL) = ("target_reps_high" IS NULL))
        AND ("target_reps_low" IS NULL OR ("target_reps_low" BETWEEN 1 AND 100
                                           AND "target_reps_high" BETWEEN 1 AND 100
                                           AND "target_reps_low" <= "target_reps_high"))
        AND ("target_rpe" IS NULL OR ("target_rpe" BETWEEN 60 AND 100 AND "target_rpe" % 5 = 0))
        AND ("rest_seconds" IS NULL OR "rest_seconds" BETWEEN 0 AND 900)
        AND ("superset_group" IS NULL OR "superset_group" BETWEEN 1 AND 99)),
    CONSTRAINT "routine_item_notes_check" CHECK ("notes" IS NULL OR char_length("notes") BETWEEN 1 AND 500)
);
-- Not deferrable: PUT deletes a routine's items before reinserting (§6.3), so no
-- transient duplicate exists. (05.0 D41 needed DEFERRABLE only for in-place shifts.)
CREATE UNIQUE INDEX "routine_item_routine_position_key" ON "routine_item" ("routine_id", "position");
CREATE INDEX "routine_item_exercise_idx" ON "routine_item" ("exercise_id");

ALTER TABLE "workout"
    ADD COLUMN "routine_id" UUID,
    ADD COLUMN "routine_name_snapshot" TEXT,
    ADD CONSTRAINT "workout_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "workout_routine_idx" ON "workout" ("routine_id") WHERE "routine_id" IS NOT NULL;

ALTER TABLE "workout_exercise"
    ADD COLUMN "superset_group"   SMALLINT,
    ADD COLUMN "target_sets"      SMALLINT,
    ADD COLUMN "target_reps_low"  SMALLINT,
    ADD COLUMN "target_reps_high" SMALLINT,
    ADD COLUMN "target_rpe"       SMALLINT,
    ADD COLUMN "rest_seconds"     SMALLINT,
    ADD CONSTRAINT "workout_exercise_targets_check" CHECK (
        ("target_sets" IS NULL OR "target_sets" BETWEEN 1 AND 20)
        AND (("target_reps_low" IS NULL) = ("target_reps_high" IS NULL))
        AND ("target_reps_low" IS NULL OR ("target_reps_low" BETWEEN 1 AND 100
                                           AND "target_reps_high" BETWEEN 1 AND 100
                                           AND "target_reps_low" <= "target_reps_high"))
        AND ("target_rpe" IS NULL OR ("target_rpe" BETWEEN 60 AND 100 AND "target_rpe" % 5 = 0))
        AND ("rest_seconds" IS NULL OR "rest_seconds" BETWEEN 0 AND 900)),
    ADD CONSTRAINT "workout_exercise_superset_group_check"
        CHECK ("superset_group" IS NULL OR "superset_group" BETWEEN 1 AND 99);
