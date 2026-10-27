-- Spec 19.0 §4 — 0016_hevy_integration. Additive, expand-only: four new tables, one widened CHECK, no data
-- statement, no backfill. A manual release step before the code (runbook).
-- Each IN (...) list is on one line: the unit drift guard renders the @sin/core lists against this file.
-- `hevy_type` is NULL only on a skip of an unsupported Hevy template (Spec 19.0 D19).
-- Down (dev/test teardown only; production undo is `git revert` + a forward migration):
--   DROP TABLE hevy_link, hevy_section_rule, hevy_exercise_pair, hevy_account;
--   (the widened workout_source_check may stay; see the spec's §11 for rows that block a rollback)

ALTER TABLE "workout" DROP CONSTRAINT "workout_source_check";
ALTER TABLE "workout" ADD CONSTRAINT "workout_source_check" CHECK ("source" IN ('manual', 'hevy'));

CREATE TABLE "hevy_exercise_pair" (
    "user_id"           UUID        NOT NULL,
    "hevy_template_id"  TEXT        NOT NULL,
    "hevy_title"        TEXT        NOT NULL,
    "hevy_type"         TEXT,
    "role"              TEXT        NOT NULL DEFAULT 'exercise',
    "exercise_id"       UUID,
    "measure_rule"      TEXT,
    "export_as"         BOOLEAN     NOT NULL DEFAULT false,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "hevy_exercise_pair_pkey" PRIMARY KEY ("user_id", "hevy_template_id"),
    CONSTRAINT "hevy_exercise_pair_user_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hevy_exercise_pair_exercise_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hevy_exercise_pair_type_check" CHECK ("hevy_type" IS NULL OR "hevy_type" IN ('weight_reps', 'reps_only', 'bodyweight_reps', 'bodyweight_assisted_reps', 'duration', 'weight_duration', 'distance_duration', 'short_distance_weight')),
    CONSTRAINT "hevy_exercise_pair_type_role_check" CHECK ("hevy_type" IS NOT NULL OR "role" = 'skip'),
    CONSTRAINT "hevy_exercise_pair_role_check" CHECK ("role" IN ('exercise', 'skip', 'warmup_placeholder', 'workout_placeholder')),
    CONSTRAINT "hevy_exercise_pair_rule_check" CHECK ("measure_rule" IS NULL OR "measure_rule" IN ('calories_as_reps', 'assist_weight_ignored')),
    CONSTRAINT "hevy_exercise_pair_exercise_role_check" CHECK (("role" = 'exercise') = ("exercise_id" IS NOT NULL)),
    CONSTRAINT "hevy_exercise_pair_export_role_check" CHECK ("export_as" = false OR "role" = 'exercise'),
    CONSTRAINT "hevy_exercise_pair_rule_role_check" CHECK ("measure_rule" IS NULL OR "role" = 'exercise')
);
CREATE UNIQUE INDEX "hevy_exercise_pair_export_as_key" ON "hevy_exercise_pair" ("user_id", "exercise_id") WHERE "export_as";
CREATE UNIQUE INDEX "hevy_exercise_pair_placeholder_key" ON "hevy_exercise_pair" ("user_id", "role") WHERE "role" IN ('warmup_placeholder', 'workout_placeholder');
CREATE INDEX "hevy_exercise_pair_exercise_idx" ON "hevy_exercise_pair" ("exercise_id");

CREATE TABLE "hevy_section_rule" (
    "user_id"    UUID NOT NULL,
    "name_key"   TEXT NOT NULL,          -- lower(trim(name))
    "name"       TEXT NOT NULL,          -- as the user wrote it
    "treatment"  TEXT NOT NULL,
    CONSTRAINT "hevy_section_rule_pkey" PRIMARY KEY ("user_id", "name_key"),
    CONSTRAINT "hevy_section_rule_user_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hevy_section_rule_treatment_check" CHECK ("treatment" IN ('warmup_placeholder', 'workout_placeholder', 'notes_on_first'))
);

CREATE TABLE "hevy_link" (
    "id"                  UUID NOT NULL,
    "user_id"             UUID NOT NULL,
    "workout_id"          UUID,          -- NULL = tombstone: the SIN workout was deleted
    "hevy_workout_id"     TEXT,          -- NULL while only a claim
    "origin"              TEXT NOT NULL,
    "claimed_at"          TIMESTAMPTZ(6),
    "synced_fingerprint"  TEXT,
    "synced_at"           TIMESTAMPTZ(6),
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "hevy_link_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hevy_link_user_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hevy_link_workout_fkey" FOREIGN KEY ("workout_id") REFERENCES "workout"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "hevy_link_origin_check" CHECK ("origin" IN ('sent', 'imported', 'matched')),
    CONSTRAINT "hevy_link_state_check" CHECK ("hevy_workout_id" IS NOT NULL OR "claimed_at" IS NOT NULL)
);
CREATE UNIQUE INDEX "hevy_link_hevy_id_key" ON "hevy_link" ("user_id", "hevy_workout_id") WHERE "hevy_workout_id" IS NOT NULL;
CREATE UNIQUE INDEX "hevy_link_workout_key" ON "hevy_link" ("workout_id") WHERE "workout_id" IS NOT NULL;

CREATE TABLE "hevy_account" (
    "user_id"        UUID NOT NULL,
    "records_stale"  BOOLEAN NOT NULL DEFAULT false,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "hevy_account_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "hevy_account_user_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
