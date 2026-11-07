-- Spec 21.1 Phase A (AC1–AC5) — every child table gets its own owner column.
--
-- The eight child tables reach their owner only through their parent today. This gives each a `user_id`,
-- filled by a BEFORE INSERT trigger (no writer SQL names it), backfilled parents first, and tied to the
-- parent's owner by a composite foreign key `(parent id, user_id)` → parent `(id, user_id)`. The database
-- then refuses a child whose owner differs from its parent's (AC3).
--
-- Expand-only (AC5): adds columns, triggers, keys and constraints. The only drops are the eight
-- single-column foreign keys, each after its composite replacement is validated. The previous release's
-- code never names `user_id` on these tables, so it runs unchanged on this schema.
--
-- A manual release step BEFORE the Phase A code merges (that code reads the new columns): runbook
-- `docs/runbooks/first-deploy.md`, "Spec 21.1 Phase A".
--
-- Left alone (D8): the ON DELETE SET NULL section links (`workout_exercise.section_id`,
-- `routine_item.section_id`), `workout.routine_id`, `hevy_link.workout_id`, every `exercise_id`.
-- schema.prisma declares the plain `userId` fields and the parents' `(id, user_id)` keys; the composite
-- foreign keys live only here (Prisma can't express them without a relation on `userId`).

-- 1. The columns. Nullable for now: adding one is metadata-only.
ALTER TABLE "workout_exercise" ADD COLUMN "user_id" UUID;
ALTER TABLE "workout_section" ADD COLUMN "user_id" UUID;
ALTER TABLE "set_entry" ADD COLUMN "user_id" UUID;
ALTER TABLE "workout_planned_set" ADD COLUMN "user_id" UUID;
ALTER TABLE "workout_section_round" ADD COLUMN "user_id" UUID;
ALTER TABLE "routine_item" ADD COLUMN "user_id" UUID;
ALTER TABLE "routine_section" ADD COLUMN "user_id" UUID;
ALTER TABLE "routine_item_set" ADD COLUMN "user_id" UUID;

-- 2. The fill triggers: one small static function per child, its parent fixed when written. A row
--    that leaves user_id NULL gets its parent's owner; a row that names one keeps it, and the composite
--    foreign key (step 5) refuses it if it differs from the parent's. They exist before the backfill, so
--    a row the running API inserts during this migration is filled too.
CREATE FUNCTION workout_exercise_fill_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT p.user_id INTO NEW.user_id FROM "workout" p WHERE p.id = NEW.workout_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workout_exercise_fill_user BEFORE INSERT ON "workout_exercise" FOR EACH ROW EXECUTE FUNCTION workout_exercise_fill_user();

CREATE FUNCTION workout_section_fill_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT p.user_id INTO NEW.user_id FROM "workout" p WHERE p.id = NEW.workout_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workout_section_fill_user BEFORE INSERT ON "workout_section" FOR EACH ROW EXECUTE FUNCTION workout_section_fill_user();

CREATE FUNCTION set_entry_fill_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT p.user_id INTO NEW.user_id FROM "workout_exercise" p WHERE p.id = NEW.workout_exercise_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER set_entry_fill_user BEFORE INSERT ON "set_entry" FOR EACH ROW EXECUTE FUNCTION set_entry_fill_user();

CREATE FUNCTION workout_planned_set_fill_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT p.user_id INTO NEW.user_id FROM "workout_exercise" p WHERE p.id = NEW.workout_exercise_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workout_planned_set_fill_user BEFORE INSERT ON "workout_planned_set" FOR EACH ROW EXECUTE FUNCTION workout_planned_set_fill_user();

CREATE FUNCTION workout_section_round_fill_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT p.user_id INTO NEW.user_id FROM "workout_section" p WHERE p.id = NEW.workout_section_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workout_section_round_fill_user BEFORE INSERT ON "workout_section_round" FOR EACH ROW EXECUTE FUNCTION workout_section_round_fill_user();

CREATE FUNCTION routine_item_fill_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT p.user_id INTO NEW.user_id FROM "routine" p WHERE p.id = NEW.routine_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER routine_item_fill_user BEFORE INSERT ON "routine_item" FOR EACH ROW EXECUTE FUNCTION routine_item_fill_user();

CREATE FUNCTION routine_section_fill_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT p.user_id INTO NEW.user_id FROM "routine" p WHERE p.id = NEW.routine_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER routine_section_fill_user BEFORE INSERT ON "routine_section" FOR EACH ROW EXECUTE FUNCTION routine_section_fill_user();

CREATE FUNCTION routine_item_set_fill_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT p.user_id INTO NEW.user_id FROM "routine_item" p WHERE p.id = NEW.routine_item_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER routine_item_set_fill_user BEFORE INSERT ON "routine_item_set" FOR EACH ROW EXECUTE FUNCTION routine_item_set_fill_user();

-- @@ backfill (the migration test applies the text above this line, inserts a row, then the rest)

-- 3. The backfill, parents before children (a child copies its parent's already-filled owner).
UPDATE "workout_exercise" c SET user_id = p.user_id FROM "workout" p WHERE p.id = c.workout_id AND c.user_id IS NULL;
UPDATE "workout_section" c SET user_id = p.user_id FROM "workout" p WHERE p.id = c.workout_id AND c.user_id IS NULL;
UPDATE "set_entry" c SET user_id = p.user_id FROM "workout_exercise" p WHERE p.id = c.workout_exercise_id AND c.user_id IS NULL;
UPDATE "workout_planned_set" c SET user_id = p.user_id FROM "workout_exercise" p WHERE p.id = c.workout_exercise_id AND c.user_id IS NULL;
UPDATE "workout_section_round" c SET user_id = p.user_id FROM "workout_section" p WHERE p.id = c.workout_section_id AND c.user_id IS NULL;
UPDATE "routine_item" c SET user_id = p.user_id FROM "routine" p WHERE p.id = c.routine_id AND c.user_id IS NULL;
UPDATE "routine_section" c SET user_id = p.user_id FROM "routine" p WHERE p.id = c.routine_id AND c.user_id IS NULL;
UPDATE "routine_item_set" c SET user_id = p.user_id FROM "routine_item" p WHERE p.id = c.routine_item_id AND c.user_id IS NULL;

-- 6. NOT NULL without a second long scan: a validated CHECK first (Postgres then skips the scan).
ALTER TABLE "workout_exercise" ADD CONSTRAINT "we_user_id_nn" CHECK ("user_id" IS NOT NULL) NOT VALID;
ALTER TABLE "workout_exercise" VALIDATE CONSTRAINT "we_user_id_nn";
ALTER TABLE "workout_exercise" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "workout_exercise" DROP CONSTRAINT "we_user_id_nn";

ALTER TABLE "workout_section" ADD CONSTRAINT "ws_user_id_nn" CHECK ("user_id" IS NOT NULL) NOT VALID;
ALTER TABLE "workout_section" VALIDATE CONSTRAINT "ws_user_id_nn";
ALTER TABLE "workout_section" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "workout_section" DROP CONSTRAINT "ws_user_id_nn";

ALTER TABLE "set_entry" ADD CONSTRAINT "se_user_id_nn" CHECK ("user_id" IS NOT NULL) NOT VALID;
ALTER TABLE "set_entry" VALIDATE CONSTRAINT "se_user_id_nn";
ALTER TABLE "set_entry" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "set_entry" DROP CONSTRAINT "se_user_id_nn";

ALTER TABLE "workout_planned_set" ADD CONSTRAINT "wps_user_id_nn" CHECK ("user_id" IS NOT NULL) NOT VALID;
ALTER TABLE "workout_planned_set" VALIDATE CONSTRAINT "wps_user_id_nn";
ALTER TABLE "workout_planned_set" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "workout_planned_set" DROP CONSTRAINT "wps_user_id_nn";

ALTER TABLE "workout_section_round" ADD CONSTRAINT "wsr_user_id_nn" CHECK ("user_id" IS NOT NULL) NOT VALID;
ALTER TABLE "workout_section_round" VALIDATE CONSTRAINT "wsr_user_id_nn";
ALTER TABLE "workout_section_round" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "workout_section_round" DROP CONSTRAINT "wsr_user_id_nn";

ALTER TABLE "routine_item" ADD CONSTRAINT "ri_user_id_nn" CHECK ("user_id" IS NOT NULL) NOT VALID;
ALTER TABLE "routine_item" VALIDATE CONSTRAINT "ri_user_id_nn";
ALTER TABLE "routine_item" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "routine_item" DROP CONSTRAINT "ri_user_id_nn";

ALTER TABLE "routine_section" ADD CONSTRAINT "rs_user_id_nn" CHECK ("user_id" IS NOT NULL) NOT VALID;
ALTER TABLE "routine_section" VALIDATE CONSTRAINT "rs_user_id_nn";
ALTER TABLE "routine_section" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "routine_section" DROP CONSTRAINT "rs_user_id_nn";

ALTER TABLE "routine_item_set" ADD CONSTRAINT "ris_user_id_nn" CHECK ("user_id" IS NOT NULL) NOT VALID;
ALTER TABLE "routine_item_set" VALIDATE CONSTRAINT "ris_user_id_nn";
ALTER TABLE "routine_item_set" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "routine_item_set" DROP CONSTRAINT "ris_user_id_nn";
