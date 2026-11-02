// Spec 19.0 D29 (minors 139, 144) — migration 0017 (hevy_link.claim_fingerprint), real Postgres.
// The whole-schema `prisma migrate diff` no-drift check moved on to timed-sections-migration (0018, CLAUDE.md).
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { applyMigrationFile, insertUser, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";

const MIGRATIONS = readdirSync(fileURLToPath(new URL("../../prisma/migrations/", import.meta.url)))
  .filter((d) => /^\d{4}_/.test(d))
  .sort();

describe.skipIf(!shouldRunIntegration())("Spec 19.0 D29 — migration 0017 (real Postgres)", () => {
  let db: IntegrationDb;
  let workout: string;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const dir of MIGRATIONS.filter((d) => d < "0017")) applyMigrationFile(db.url, dir);
    const user = await insertUser(db);
    workout = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "workout" ("id","user_id","started_at","ended_at","local_date","tz_offset_minutes","client_generated_id")
       VALUES ($1::uuid,$2::uuid,now() - interval '1 hour',now(),current_date,0,$3::uuid)`,
      workout,
      user,
      uuidv7(),
    );
    // A claim taken by the old code, in flight across the deploy.
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "hevy_link" ("id","user_id","workout_id","origin","claimed_at") VALUES ($1::uuid,$2::uuid,$3::uuid,'sent',now())`,
      uuidv7(),
      user,
      workout,
    );
    for (const dir of MIGRATIONS.filter((d) => d >= "0017")) applyMigrationFile(db.url, dir);
  }, 240_000);
  afterAll(async () => {
    await db?.stop();
  });

  it("minors 139, 144 — a claim from before 0017 is kept, with no stored fingerprint", async () => {
    const rows = await db.prisma.$queryRawUnsafe<{ claimed: boolean; claim_fingerprint: string | null }[]>(
      `SELECT claimed_at IS NOT NULL AS claimed, claim_fingerprint FROM "hevy_link" WHERE workout_id = $1::uuid`,
      workout,
    );
    expect(rows).toEqual([{ claimed: true, claim_fingerprint: null }]);
  });
});
