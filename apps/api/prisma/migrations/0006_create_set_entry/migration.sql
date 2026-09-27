-- Spec 05.1 §4 — 0006_create_set_entry. Additive, expand-only.
-- Down = DROP TABLE "set_entry";  (test teardown / local `migrate reset` only —
-- never production, per Spec 05.1 §11; production undo is `git revert` + a
-- forward migration.)
--
-- Hand-authored: the three CHECK (... IN (...)) literal lists and the two
-- GENERATED ALWAYS AS ... STORED columns are not expressible in the Prisma
-- schema DSL, so this .sql file is the source of truth and the Prisma model
-- carries the client shape only (05.0 §4 / 03.1 0002 carve-out). The
-- conversion constants must equal @sin/core's LB_TO_KG / KM_TO_M / MI_TO_M
-- (DESIGN §4.8, R4) — test/unit/set-entry-migration-drift-guard.test.ts.

CREATE TABLE "set_entry" (
    "id"                  UUID           NOT NULL,
    "workout_exercise_id" UUID           NOT NULL,
    "set_number"          SMALLINT       NOT NULL,
    "set_type"            TEXT           NOT NULL DEFAULT 'working',
    "reps"                SMALLINT,
    "weight"              NUMERIC(7,3),
    "weight_unit"         TEXT,
    "weight_kg"           NUMERIC(7,3) GENERATED ALWAYS AS (
                            CASE WHEN "weight" IS NULL THEN NULL
                                 WHEN "weight_unit" = 'kg' THEN "weight"
                                 ELSE "weight" * 0.45359237 END
                          ) STORED,
    "distance"            NUMERIC(9,3),
    "distance_unit"       TEXT,
    "distance_m"          NUMERIC(9,3) GENERATED ALWAYS AS (
                            CASE WHEN "distance" IS NULL THEN NULL
                                 WHEN "distance_unit" = 'm' THEN "distance"
                                 WHEN "distance_unit" = 'km' THEN "distance" * 1000
                                 ELSE "distance" * 1609.344 END
                          ) STORED,
    "duration_s"          INTEGER,
    "rpe"                 NUMERIC(3,1),
    "is_complete"         BOOLEAN        NOT NULL DEFAULT false,
    "completed_at"        TIMESTAMPTZ(6),
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "set_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "set_entry_set_type_check" CHECK ("set_type" IN ('warmup', 'working', 'drop', 'failure')),
    CONSTRAINT "set_entry_weight_unit_check" CHECK ("weight_unit" IN ('kg', 'lb') OR "weight_unit" IS NULL),
    CONSTRAINT "set_entry_distance_unit_check" CHECK ("distance_unit" IN ('m', 'km', 'mi') OR "distance_unit" IS NULL),
    CONSTRAINT "set_entry_workout_exercise_id_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "workout_exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Plain (non-deferrable): set_number is append-only and never renumbered
-- (Spec 05.1 D2/D6). Backstop behind the create path's advisory lock (§6.3);
-- its leading column also serves every workout_exercise_id lookup.
CREATE UNIQUE INDEX "set_entry_workout_exercise_number_key" ON "set_entry" ("workout_exercise_id", "set_number");
