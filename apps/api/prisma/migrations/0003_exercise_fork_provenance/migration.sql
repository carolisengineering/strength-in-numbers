-- Spec 03.2 §4 — 0003_exercise_fork_provenance. Additive, expand-only.
-- Down = ALTER TABLE "exercise" DROP CONSTRAINT "exercise_forked_from_exercise_id_fkey",
--        DROP COLUMN "forked_from_exercise_id"; (test teardown / local `migrate reset`
-- only — production undo is `git revert` + a forward migration, per Spec 01 §11.)
--
-- RESTRICT matches the existing primary_muscle_id / equipment_id convention. The
-- self-reference always points at a global row in practice (enforced at the
-- application layer — forking never chains, Spec 03.2 §6), not by a CHECK (which
-- cannot reference another row of the same table). No new index: nothing queries
-- *by* this column yet (Spec 03.2 §4).

ALTER TABLE "exercise" ADD COLUMN "forked_from_exercise_id" UUID NULL;
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_forked_from_exercise_id_fkey"
  FOREIGN KEY ("forked_from_exercise_id") REFERENCES "exercise"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
