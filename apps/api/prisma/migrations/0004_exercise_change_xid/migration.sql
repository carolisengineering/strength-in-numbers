-- Spec 03.3 §4 — 0004_exercise_change_xid. Additive, expand-only.
-- Down (test teardown / local `migrate reset` only, never production —
-- Spec 01 §11): DROP TRIGGER exercise_change_xid ON "exercise";
--               DROP FUNCTION exercise_stamp_change_xid();
--               DROP INDEX "exercise_change_xid_idx";
--               ALTER TABLE "exercise" DROP COLUMN "change_xid";

-- One statement: existing rows read this migration's xid from the column
-- default. pg_current_xact_id() is STABLE, so on Postgres >= 11 this takes the
-- fast-default path (no table rewrite; the value is stored once in the catalog).
-- The column is never nullable, so there is no backfill UPDATE and no separate
-- SET NOT NULL scan. The trigger is created after, so the default — not the
-- trigger — stamps the pre-existing rows.
ALTER TABLE "exercise"
  ADD COLUMN "change_xid" xid8 NOT NULL DEFAULT pg_current_xact_id();

CREATE FUNCTION exercise_stamp_change_xid() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.change_xid := pg_current_xact_id();
  RETURN NEW;
END $$;

CREATE TRIGGER exercise_change_xid BEFORE INSERT OR UPDATE ON "exercise"
  FOR EACH ROW EXECUTE FUNCTION exercise_stamp_change_xid();

CREATE INDEX "exercise_change_xid_idx" ON "exercise" ("change_xid");
