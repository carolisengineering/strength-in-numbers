-- Spec 01 §4 — 0001_create_user. Additive, expand-only. Down = DROP TABLE "user".

CREATE TABLE "user" (
    "id"              UUID           NOT NULL,
    "auth_sub"        TEXT           NOT NULL,
    "email"           TEXT           NOT NULL,
    "email_verified"  BOOLEAN        NOT NULL DEFAULT false,
    "display_name"    TEXT,
    "unit_preference" TEXT           NOT NULL DEFAULT 'kg',
    "timezone"        TEXT           NOT NULL DEFAULT 'UTC',
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "deleted_at"      TIMESTAMPTZ(6),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_unit_preference_check" CHECK ("unit_preference" IN ('kg', 'lb'))
);

CREATE UNIQUE INDEX "user_auth_sub_key" ON "user" ("auth_sub");
CREATE INDEX "user_email_idx" ON "user" ("email");
