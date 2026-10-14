-- Spec 09.2 §4 — 0011_create_routine_sections. Additive, expand-only.
-- Down (dev/test teardown only; production undo is `git revert` + a forward migration):
--   ALTER TABLE "workout_exercise" DROP COLUMN "section_id";
--   ALTER TABLE "routine_item" DROP COLUMN "section_id";
--   ALTER TABLE "workout" DROP COLUMN "routine_notes_snapshot";
--   DROP TABLE "workout_section", "routine_section";

CREATE TABLE "routine_section" (
    "id"         UUID           NOT NULL,
    "routine_id" UUID           NOT NULL,
    "position"   SMALLINT       NOT NULL,
    "name"       TEXT           NOT NULL,
    "notes"      TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "routine_section_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routine_section_routine_fkey" FOREIGN KEY ("routine_id") REFERENCES "routine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "routine_section_position_check" CHECK ("position" BETWEEN 0 AND 7),
    CONSTRAINT "routine_section_name_check" CHECK (char_length("name") BETWEEN 1 AND 40 AND "name" = btrim("name")),
    CONSTRAINT "routine_section_notes_check" CHECK ("notes" IS NULL OR char_length("notes") BETWEEN 1 AND 2000)
);
-- Not deferrable: PUT deletes a routine's sections before re-inserting (Spec 09.2 §6.2).
-- Also the FK lookup index, and with the position CHECK it caps a routine at 8 sections.
CREATE UNIQUE INDEX "routine_section_routine_position_key" ON "routine_section" ("routine_id", "position");

CREATE TABLE "workout_section" (
    "id"         UUID           NOT NULL,
    "workout_id" UUID           NOT NULL,
    "position"   SMALLINT       NOT NULL,
    "name"       TEXT           NOT NULL,
    "notes"      TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "workout_section_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_section_workout_fkey" FOREIGN KEY ("workout_id") REFERENCES "workout"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workout_section_position_check" CHECK ("position" BETWEEN 0 AND 7),
    CONSTRAINT "workout_section_name_check" CHECK (char_length("name") BETWEEN 1 AND 40 AND "name" = btrim("name")),
    CONSTRAINT "workout_section_notes_check" CHECK ("notes" IS NULL OR char_length("notes") BETWEEN 1 AND 2000)
);
CREATE UNIQUE INDEX "workout_section_workout_position_key" ON "workout_section" ("workout_id", "position");

ALTER TABLE "routine_item"
    ADD COLUMN "section_id" UUID,
    ADD CONSTRAINT "routine_item_section_fkey" FOREIGN KEY ("section_id") REFERENCES "routine_section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Postgres implements SET NULL by scanning the referencing table for the deleted id; the partial
-- index keeps that cheap (including the cascade of a whole routine) and costs nothing for loose items.
CREATE INDEX "routine_item_section_idx" ON "routine_item" ("section_id") WHERE "section_id" IS NOT NULL;

ALTER TABLE "workout_exercise"
    ADD COLUMN "section_id" UUID,
    ADD CONSTRAINT "workout_exercise_section_fkey" FOREIGN KEY ("section_id") REFERENCES "workout_section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "workout_exercise_section_idx" ON "workout_exercise" ("section_id") WHERE "section_id" IS NOT NULL;

ALTER TABLE "workout"
    ADD COLUMN "routine_notes_snapshot" TEXT,
    ADD CONSTRAINT "workout_routine_notes_snapshot_check"
        CHECK ("routine_notes_snapshot" IS NULL OR char_length("routine_notes_snapshot") BETWEEN 1 AND 2000);
