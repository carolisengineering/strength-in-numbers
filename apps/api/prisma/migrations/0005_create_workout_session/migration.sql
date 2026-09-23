-- Spec 05.0 §4 — 0005_create_workout_session. Additive, expand-only.
-- Down = DROP TABLE "workout_exercise", "workout";  (test teardown / local
-- `migrate reset` only — never production, per Spec 01 §11 / Spec 05.0 §11;
-- production undo is `git revert` + a forward migration.)
--
-- Hand-authored (`prisma migrate diff` as a starting point, then edited): the
-- partial unique index (WHERE ended_at IS NULL), the two CHECK (... IN (...))
-- literal lists, and the DEFERRABLE unique constraint are not expressible in
-- the Prisma schema DSL, so this .sql file is the source of truth and the
-- Prisma models carry the client shape only (Spec 05.0 §4, following 03.1's
-- 0002 carve-out).

CREATE TABLE "workout" (
    "id"                   UUID           NOT NULL,
    "user_id"              UUID           NOT NULL,
    "title"                TEXT,
    "notes"                TEXT,
    "started_at"           TIMESTAMPTZ(6) NOT NULL,
    "ended_at"             TIMESTAMPTZ(6),
    "local_date"           DATE           NOT NULL,
    "tz_offset_minutes"    SMALLINT       NOT NULL,
    "client_generated_id"  UUID           NOT NULL,
    "source"               TEXT           NOT NULL DEFAULT 'manual',
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "workout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_source_check" CHECK ("source" IN ('manual')),
    CONSTRAINT "workout_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "workout_exercise" (
    "id"                     UUID           NOT NULL,
    "workout_id"             UUID           NOT NULL,
    "position"               SMALLINT       NOT NULL,
    "exercise_id"            UUID           NOT NULL,
    "exercise_name_snapshot" TEXT           NOT NULL,
    "modality_snapshot"      TEXT           NOT NULL,
    "notes"                  TEXT,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "workout_exercise_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_exercise_modality_snapshot_check" CHECK ("modality_snapshot" IN ('weight_reps', 'bodyweight_reps', 'weighted_bodyweight', 'duration', 'distance_duration')),
    CONSTRAINT "workout_exercise_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workout"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workout_exercise_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workout_user_client_id_key" ON "workout" ("user_id", "client_generated_id");
CREATE INDEX "workout_user_started_idx" ON "workout" ("user_id", "started_at" DESC);
-- At most one in-progress session per user (Spec 05.0 D38) — a database
-- invariant, not a check-then-insert race. Also the GET /v1/workouts/active
-- lookup's access path.
CREATE UNIQUE INDEX "workout_user_active_key" ON "workout" ("user_id") WHERE "ended_at" IS NULL;

-- Must be a constraint, not a bare index — Postgres cannot defer a plain
-- unique index (Spec 05.0 D41). INITIALLY IMMEDIATE keeps ordinary
-- inserts/deletes strict; only the reorder transaction opts into DEFERRED via
-- `SET CONSTRAINTS workout_exercise_position_key DEFERRED`.
ALTER TABLE "workout_exercise" ADD CONSTRAINT "workout_exercise_position_key"
  UNIQUE ("workout_id", "position") DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "workout_exercise_exercise_idx" ON "workout_exercise" ("exercise_id");
