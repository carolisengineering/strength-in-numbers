-- Spec 21.1 Phase C, §4.3 — the restricted application login, its exact grants, and the row-level-security policies.
--
-- INERT UNTIL 0021: no table gets ENABLE ROW LEVEL SECURITY here, so the policies do nothing yet. The role gets its
-- login and password from `pnpm --filter @sin/api run db:app-role`, never here (a migration cannot carry a password).
-- Safe to repeat: the role is created only if absent (a Prisma shadow database, a test container, a second database
-- of the same cluster), and the grants are revoked and given again. No ALTER DEFAULT PRIVILEGES: a future table is
-- invisible to sin_app until its own migration grants it and gives it a policy. No FORCE ROW LEVEL SECURITY (D6).
-- No sequences: every primary key is application-generated.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sin_app') THEN
    CREATE ROLE sin_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sin_app;
GRANT USAGE ON SCHEMA public TO sin_app;                     -- not CREATE

-- Policy helpers: one definition of the setting names and of "empty means no user". After a transaction-local
-- set_config ends, the setting reads back as '' on that connection, so nullif maps it to NULL (matches nothing).
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_auth_sub() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.auth_sub', true), '') $$;
GRANT EXECUTE ON FUNCTION app_user_id(), app_auth_sub() TO sin_app;

-- Owned tables: every one carries user_id (0019 gave the eight child tables theirs). (SELECT app_user_id()) is
-- evaluated once per statement, not once per row.
GRANT SELECT, INSERT, UPDATE, DELETE ON "workout" TO sin_app;
CREATE POLICY workout_own ON "workout" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "routine" TO sin_app;
CREATE POLICY routine_own ON "routine" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "personal_record" TO sin_app;
CREATE POLICY personal_record_own ON "personal_record" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "hevy_exercise_pair" TO sin_app;
CREATE POLICY hevy_exercise_pair_own ON "hevy_exercise_pair" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "hevy_section_rule" TO sin_app;
CREATE POLICY hevy_section_rule_own ON "hevy_section_rule" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "hevy_link" TO sin_app;
CREATE POLICY hevy_link_own ON "hevy_link" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "hevy_account" TO sin_app;
CREATE POLICY hevy_account_own ON "hevy_account" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "workout_exercise" TO sin_app;
CREATE POLICY workout_exercise_own ON "workout_exercise" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "workout_section" TO sin_app;
CREATE POLICY workout_section_own ON "workout_section" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "set_entry" TO sin_app;
CREATE POLICY set_entry_own ON "set_entry" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "workout_planned_set" TO sin_app;
CREATE POLICY workout_planned_set_own ON "workout_planned_set" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "workout_section_round" TO sin_app;
CREATE POLICY workout_section_round_own ON "workout_section_round" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "routine_item" TO sin_app;
CREATE POLICY routine_item_own ON "routine_item" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "routine_section" TO sin_app;
CREATE POLICY routine_section_own ON "routine_section" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "routine_item_set" TO sin_app;
CREATE POLICY routine_item_set_own ON "routine_item_set" TO sin_app
  USING      (user_id = (SELECT app_user_id()))
  WITH CHECK (user_id = (SELECT app_user_id()));

-- user: identity. No DELETE (the purge runs as the owner), no change of id or auth_sub. Provisioning sees and inserts
-- a row by the token's subject (app.auth_sub) before an id exists.
GRANT SELECT, INSERT ON "user" TO sin_app;
GRANT UPDATE (email, email_verified, display_name, unit_preference, timezone, updated_at, deleted_at) ON "user" TO sin_app;
CREATE POLICY user_select ON "user" FOR SELECT TO sin_app
  USING (id = (SELECT app_user_id()) OR auth_sub = (SELECT app_auth_sub()));
CREATE POLICY user_insert ON "user" FOR INSERT TO sin_app
  WITH CHECK (auth_sub = (SELECT app_auth_sub()));
CREATE POLICY user_update ON "user" FOR UPDATE TO sin_app
  USING (id = (SELECT app_user_id())) WITH CHECK (id = (SELECT app_user_id()));

-- exercise: the shared catalog rows (NULL owner) are readable and lockable by everyone; changes only to one's own.
-- The UPDATE column list is exactly what the API's UPDATE "exercise" statements SET (exercise.prisma.ts). A row lock
-- (FOR SHARE) must pass the UPDATE policy's USING too, so it admits a global row; WITH CHECK keeps any write own.
GRANT SELECT, INSERT ON "exercise" TO sin_app;
GRANT UPDATE (name, modality, primary_muscle_id, secondary_muscle_ids, equipment_id, is_active, updated_at) ON "exercise" TO sin_app;
CREATE POLICY exercise_select ON "exercise" FOR SELECT TO sin_app
  USING (owner_user_id IS NULL OR owner_user_id = (SELECT app_user_id()));
CREATE POLICY exercise_insert ON "exercise" FOR INSERT TO sin_app
  WITH CHECK (owner_user_id = (SELECT app_user_id()));
CREATE POLICY exercise_update ON "exercise" FOR UPDATE TO sin_app
  USING      (owner_user_id IS NULL OR owner_user_id = (SELECT app_user_id()))
  WITH CHECK (owner_user_id = (SELECT app_user_id()));

-- Shared reference data.
GRANT SELECT ON "muscle_group", "equipment" TO sin_app;
CREATE POLICY muscle_group_read ON "muscle_group" FOR SELECT TO sin_app USING (true);
CREATE POLICY equipment_read    ON "equipment"    FOR SELECT TO sin_app USING (true);
