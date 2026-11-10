-- Spec 21.1 Phase D, §4.4 — switch row-level security on for all 19 application tables. The policies and grants are
-- 0020's; from this commit they apply, so `sin_app` reads and changes only the current user's rows plus the shared ones.
--
-- No FORCE (D6): the owner login stays exempt, so migrations and maintenance commands work as before.
-- To switch off in an emergency use `db:rls -- disable`, never a migration (D12). `_prisma_migrations` is not touched.

-- Every lock up front (as in 0019 and 0020). ENABLE ROW LEVEL SECURITY takes ACCESS EXCLUSIVE on its table, and
-- `prisma migrate deploy` runs this file as one transaction, so each lock is held to the commit. Taking them all in one
-- statement, in the order the API's locking writes use, keeps the window for a conflict to this statement. If the
-- migration fails, for that or the 5 s lock timeout, it changes nothing (runbook, "RLS rollout": `migrate resolve
-- --rolled-back`, then retry).
SET lock_timeout = '5s';
LOCK TABLE "routine", "workout", "routine_item", "routine_section", "routine_item_set", "workout_exercise",
  "workout_section", "set_entry", "workout_planned_set", "workout_section_round", "personal_record",
  "hevy_exercise_pair", "hevy_section_rule", "hevy_link", "hevy_account", "exercise", "user", "muscle_group", "equipment"
  IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exercise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "muscle_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hevy_exercise_pair" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hevy_section_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hevy_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hevy_account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workout_exercise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workout_section" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "set_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workout_planned_set" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workout_section_round" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_section" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_item_set" ENABLE ROW LEVEL SECURITY;
