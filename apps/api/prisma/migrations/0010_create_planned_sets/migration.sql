-- Spec 09.1 §4 — 0010_create_planned_sets. Additive, expand-only.
-- Down (dev/test teardown only; production undo is `git revert` + a forward migration):
--   DROP TABLE "workout_planned_set", "routine_item_set";

CREATE TABLE "routine_item_set" (
    "id"              UUID           NOT NULL,
    "routine_item_id" UUID           NOT NULL,
    "position"        SMALLINT       NOT NULL,
    "set_type"        TEXT           NOT NULL DEFAULT 'working',
    "reps_low"        SMALLINT,
    "reps_high"       SMALLINT,
    "weight"          NUMERIC(7,3),
    "weight_unit"     TEXT,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "routine_item_set_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routine_item_set_item_fkey" FOREIGN KEY ("routine_item_id") REFERENCES "routine_item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "routine_item_set_position_check" CHECK ("position" BETWEEN 0 AND 19),
    CONSTRAINT "routine_item_set_type_check" CHECK ("set_type" IN ('warmup', 'working', 'drop', 'failure')),
    CONSTRAINT "routine_item_set_reps_check" CHECK (
        (("reps_low" IS NULL) = ("reps_high" IS NULL))
        AND ("reps_low" IS NULL OR ("reps_low" BETWEEN 1 AND 100
                                    AND "reps_high" BETWEEN 1 AND 100
                                    AND "reps_low" <= "reps_high"))),
    CONSTRAINT "routine_item_set_weight_check" CHECK (
        (("weight" IS NULL) = ("weight_unit" IS NULL))
        AND ("weight" IS NULL OR "weight" >= 0)
        AND ("weight_unit" IS NULL OR "weight_unit" IN ('kg', 'lb')))
);
-- Not deferrable: PUT deletes an item (cascading its rows) before re-inserting (Spec 09 §6.3).
-- Also the FK lookup index; with the position CHECK it caps a parent at 20 rows.
CREATE UNIQUE INDEX "routine_item_set_item_position_key" ON "routine_item_set" ("routine_item_id", "position");

CREATE TABLE "workout_planned_set" (
    "id"                  UUID           NOT NULL,
    "workout_exercise_id" UUID           NOT NULL,
    "position"            SMALLINT       NOT NULL,
    "set_type"            TEXT           NOT NULL DEFAULT 'working',
    "reps_low"            SMALLINT,
    "reps_high"           SMALLINT,
    "weight"              NUMERIC(7,3),
    "weight_unit"         TEXT,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "workout_planned_set_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_planned_set_exercise_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "workout_exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workout_planned_set_position_check" CHECK ("position" BETWEEN 0 AND 19),
    CONSTRAINT "workout_planned_set_type_check" CHECK ("set_type" IN ('warmup', 'working', 'drop', 'failure')),
    CONSTRAINT "workout_planned_set_reps_check" CHECK (
        (("reps_low" IS NULL) = ("reps_high" IS NULL))
        AND ("reps_low" IS NULL OR ("reps_low" BETWEEN 1 AND 100
                                    AND "reps_high" BETWEEN 1 AND 100
                                    AND "reps_low" <= "reps_high"))),
    CONSTRAINT "workout_planned_set_weight_check" CHECK (
        (("weight" IS NULL) = ("weight_unit" IS NULL))
        AND ("weight" IS NULL OR "weight" >= 0)
        AND ("weight_unit" IS NULL OR "weight_unit" IN ('kg', 'lb')))
);
CREATE UNIQUE INDEX "workout_planned_set_exercise_position_key" ON "workout_planned_set" ("workout_exercise_id", "position");

-- Backfill (AC18, AC19): N identical working rows per item that has a set count.
-- Items with target_sets NULL get none and keep their rep columns (O1). Guarded so it can be re-run.
-- BACKFILL-BEGIN
INSERT INTO "routine_item_set" ("id", "routine_item_id", "position", "set_type", "reps_low", "reps_high")
SELECT gen_random_uuid(), ri."id", g.n, 'working', ri."target_reps_low", ri."target_reps_high"
FROM "routine_item" ri
CROSS JOIN LATERAL generate_series(0, ri."target_sets" - 1) AS g(n)
WHERE ri."target_sets" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "routine_item_set" s WHERE s."routine_item_id" = ri."id");
-- BACKFILL-END
