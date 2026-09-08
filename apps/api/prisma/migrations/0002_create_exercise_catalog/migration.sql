-- Spec 03.1 §4 — 0002_create_exercise_catalog. Additive, expand-only.
-- Down = DROP TABLE "exercise", "equipment", "muscle_group";  (test teardown /
-- local `migrate reset` only — never in production, per Spec 01 §11 / Spec 03.1
-- §11; production undo is `git revert` + a forward migration.)
--
-- Hand-authored (`prisma migrate diff` as a starting point, then edited): the
-- partial unique index (WHERE owner_user_id IS NULL) and the modality CHECK are
-- not expressible in the Prisma schema DSL, so this .sql file is the source of
-- truth and the Prisma models carry the client shape only (Spec 03.1 §4).

CREATE TABLE "muscle_group" (
    "id"            TEXT           NOT NULL,
    "name"          TEXT           NOT NULL,
    "display_order" SMALLINT       NOT NULL DEFAULT 0,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "muscle_group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "equipment" (
    "id"            TEXT           NOT NULL,
    "name"          TEXT           NOT NULL,
    "display_order" SMALLINT       NOT NULL DEFAULT 0,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exercise" (
    "id"                   UUID           NOT NULL,
    "catalog_key"          TEXT,
    "owner_user_id"        UUID,
    "name"                 TEXT           NOT NULL,
    "modality"             TEXT           NOT NULL,
    "primary_muscle_id"    TEXT,
    "secondary_muscle_ids" TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "equipment_id"         TEXT,
    "is_active"            BOOLEAN        NOT NULL DEFAULT true,
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "exercise_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exercise_modality_check" CHECK ("modality" IN ('weight_reps', 'bodyweight_reps', 'weighted_bodyweight', 'duration', 'distance_duration')),
    CONSTRAINT "exercise_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exercise_primary_muscle_id_fkey" FOREIGN KEY ("primary_muscle_id") REFERENCES "muscle_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "exercise_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Uniqueness applies to curated rows only; custom rows (owner_user_id set) carry
-- catalog_key = NULL and are exempt (Spec 03.1 §4, AC3).
CREATE UNIQUE INDEX "exercise_catalog_key_key" ON "exercise" ("catalog_key") WHERE "owner_user_id" IS NULL;
CREATE INDEX "exercise_owner_idx" ON "exercise" ("owner_user_id");
-- Drives ?updated_since (Spec 03.1 §6.1).
CREATE INDEX "exercise_updated_at_idx" ON "exercise" ("updated_at");
