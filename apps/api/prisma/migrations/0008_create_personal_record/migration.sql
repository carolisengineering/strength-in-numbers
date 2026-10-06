-- Spec 07.0 §4 — 0008_create_personal_record. Additive, expand-only.
-- Down = DROP TABLE "personal_record";
-- (test teardown / local `migrate reset` only — never production, per Spec
-- 07.0 §11; production undo is `git revert` + a forward migration.)
--
-- A rebuildable cache of each user's personal records, one row per
-- (user, lineage root, record type). Rows are replaced wholesale by the
-- recompute (§6.3), so there is no updated_at and the id is not stable.
-- No backfill here: `records:rebuild` is the release step that fills it.
--
-- `exercise_id` is the LINEAGE ROOT (§6.2), COALESCE(forked_from_exercise_id,
-- id) — not necessarily the exercise logged. Every FK cascades so an account
-- purge needs no ordering step (AC23, mirrors 05.0 D37).
CREATE TABLE "personal_record" (
    "id"                  UUID           NOT NULL,
    "user_id"             UUID           NOT NULL,
    "exercise_id"         UUID           NOT NULL,
    "record_type"         TEXT           NOT NULL,
    "value" NUMERIC(12,3) NOT NULL,
    "unit"                TEXT           NOT NULL,
    "previous_value" NUMERIC(12,3),
    "source_set_entry_id" UUID           NOT NULL,
    "workout_id"          UUID           NOT NULL,
    "achieved_at"         TIMESTAMPTZ(6) NOT NULL,
    "local_date"          DATE           NOT NULL,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "personal_record_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "personal_record_record_type_check"
        CHECK ("record_type" IN ('heaviest_weight', 'best_est_1rm', 'best_set_volume', 'max_reps')),
    CONSTRAINT "personal_record_unit_check"
        CHECK ("unit" IN ('kg', 'kg_reps', 'reps')),
    -- D17: one legal unit per type, rendered from RECORD_UNIT_BY_TYPE.
    CONSTRAINT "personal_record_type_unit_check" CHECK (
        ("record_type" = 'heaviest_weight' AND "unit" = 'kg')
        OR ("record_type" = 'best_est_1rm' AND "unit" = 'kg')
        OR ("record_type" = 'best_set_volume' AND "unit" = 'kg_reps')
        OR ("record_type" = 'max_reps' AND "unit" = 'reps')
    ),
    CONSTRAINT "personal_record_value_check" CHECK ("value" > 0),
    CONSTRAINT "personal_record_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "personal_record_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "personal_record_source_set_entry_id_fkey" FOREIGN KEY ("source_set_entry_id") REFERENCES "set_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "personal_record_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workout"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "personal_record_user_exercise_type_key"
    ON "personal_record" ("user_id", "exercise_id", "record_type");
-- ?workoutId= lookup and the workout-delete cascade.
CREATE INDEX "personal_record_workout_idx" ON "personal_record" ("workout_id");
-- The set_entry cascade.
CREATE INDEX "personal_record_source_set_idx" ON "personal_record" ("source_set_entry_id");
