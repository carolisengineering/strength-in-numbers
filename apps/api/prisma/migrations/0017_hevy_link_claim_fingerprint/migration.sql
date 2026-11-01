-- Spec 19.0 D29 (minors 139, 144) — 0017_hevy_link_claim_fingerprint. Additive: one nullable column, no backfill.
-- A manual release step before the code (runbook). The begin stores its fingerprint on the claim; complete compares the
-- body's against it and stores this one. A claim taken before the code is live has NULL here and completes as before.
-- Down (dev/test teardown only; production undo is `git revert` + a forward migration):
--   ALTER TABLE "hevy_link" DROP COLUMN "claim_fingerprint";

ALTER TABLE "hevy_link" ADD COLUMN "claim_fingerprint" TEXT;
