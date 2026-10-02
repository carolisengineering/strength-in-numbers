-- Spec 05.1 §4 / D15 — 0007_set_entry_client_generated_id. Additive, expand-only.
-- Down = DROP INDEX "set_entry_workout_exercise_client_id_key";
--        ALTER TABLE "set_entry" DROP COLUMN "client_generated_id";
-- (test teardown / local `migrate reset` only — never production, per Spec
-- 05.1 §11; production undo is `git revert` + a forward migration.)
--
-- The optional idempotency key for POST /v1/workout-exercises/{id}/sets.
-- Nullable with no default, so adding it rewrites nothing and existing rows
-- (and every create that sends no key) hold NULL.
ALTER TABLE "set_entry" ADD COLUMN "client_generated_id" UUID;

-- Scoped per workout_exercise, the same scope set_number has. NULLs are
-- distinct in a unique index, so any number of keyless sets coexist. Backstop
-- behind the create path's lookup under its advisory lock (§6.2).
CREATE UNIQUE INDEX "set_entry_workout_exercise_client_id_key" ON "set_entry" ("workout_exercise_id", "client_generated_id");
