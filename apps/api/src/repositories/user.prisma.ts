import { Prisma, type PrismaClient, type User as PrismaUser } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { toScoped, type UserScopedDb } from "../db/scoped.js";
import type {
  ProfilePatch,
  ProvisionInput,
  ProvisionResult,
  UnitPreference,
  UserRecord,
  UserRepository,
} from "./user.js";

/**
 * Prisma-backed UserRepository (Spec 01 §6.2, §6.3).
 *
 * `provision` uses raw `INSERT ... ON CONFLICT DO NOTHING` + a re-read: the
 * affected-row count tells us whether *this* call created the row, which is the
 * only way `isNewUser` stays correct under the concurrent-first-request race
 * (Spec 01 criterion 8).
 *
 * Spec 21.1 AC15 — the lookup, the insert and the re-read run on `forAuthSub` (the
 * token's subject is all we know before the row is found); every write after that
 * runs on `as(id)`. The former Prisma model calls are raw statements with the same
 * columns and mapping, because the scoped handle carries only raw statements.
 */

const USER_COLUMNS = Prisma.sql`
  id, auth_sub, email, email_verified, display_name, unit_preference, timezone, created_at, updated_at, deleted_at`;

interface UserDbRow {
  id: string;
  auth_sub: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
  unit_preference: string;
  timezone: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function fromRow(row: UserDbRow): UserRecord {
  return {
    id: row.id,
    authSub: row.auth_sub,
    email: row.email,
    emailVerified: row.email_verified,
    displayName: row.display_name,
    unitPreference: row.unit_preference as UnitPreference,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** The model-row mapping, kept for the account export's model read. */
function toRecord(row: PrismaUser): UserRecord {
  return {
    id: row.id,
    authSub: row.authSub,
    email: row.email,
    emailVerified: row.emailVerified,
    displayName: row.displayName,
    unitPreference: row.unitPreference as UnitPreference,
    timezone: row.timezone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/** A model `update` threw (P2025) on a missing row; the raw statement returns none, so throw the same way (a 500). */
function updated(rows: UserDbRow[], what: string): UserRecord {
  const row = rows[0];
  if (!row) throw new Error(`${what}: user row not found`);
  return fromRow(row);
}

export function createUserRepository(db: UserScopedDb | PrismaClient): UserRepository {
  const scoped = toScoped(db);
  return {
    async findByAuthSub(authSub: string): Promise<UserRecord | null> {
      const c = scoped.forAuthSub(authSub);
      const rows = await c.$queryRaw<UserDbRow[]>`SELECT ${USER_COLUMNS} FROM "user" WHERE auth_sub = ${authSub}`;
      return rows[0] ? fromRow(rows[0]) : null;
    },

    async provision(input: ProvisionInput): Promise<ProvisionResult> {
      const c = scoped.forAuthSub(input.authSub);
      const id = uuidv7();
      const inserted = await c.$executeRaw`
        INSERT INTO "user" ("id", "auth_sub", "email", "email_verified")
        VALUES (${id}::uuid, ${input.authSub}, ${input.email}, ${input.emailVerified})
        ON CONFLICT ("auth_sub") DO NOTHING
      `;
      const rows = await c.$queryRaw<UserDbRow[]>`SELECT ${USER_COLUMNS} FROM "user" WHERE auth_sub = ${input.authSub}`;
      if (!rows[0]) {
        throw new Error("provision: user row missing after upsert + re-read");
      }
      return { user: fromRow(rows[0]), isNewUser: inserted === 1 };
    },

    async syncEmail(id: string, email: string, emailVerified: boolean): Promise<UserRecord> {
      const c = scoped.as(id);
      const rows = await c.$queryRaw<UserDbRow[]>`
        UPDATE "user" SET email = ${email}, email_verified = ${emailVerified}, updated_at = ${new Date()}
        WHERE id = ${id}::uuid
        RETURNING ${USER_COLUMNS}
      `;
      return updated(rows, "syncEmail");
    },

    async updateProfile(id: string, patch: ProfilePatch): Promise<UserRecord> {
      const c = scoped.as(id);
      // One fixed statement: a key absent from the patch keeps its column (displayName may be set to null, so it
      // carries its own flag; the other two are never null when present).
      const rows = await c.$queryRaw<UserDbRow[]>`
        UPDATE "user" SET
          display_name = CASE WHEN ${patch.displayName !== undefined}::boolean THEN ${patch.displayName ?? null}::text ELSE display_name END,
          unit_preference = COALESCE(${patch.unitPreference ?? null}::text, unit_preference),
          timezone = COALESCE(${patch.timezone ?? null}::text, timezone),
          updated_at = ${new Date()}
        WHERE id = ${id}::uuid
        RETURNING ${USER_COLUMNS}
      `;
      return updated(rows, "updateProfile");
    },

    async markDeleted(id: string): Promise<Date | null> {
      const c = scoped.as(id);
      const rows = await c.$queryRaw<{ deleted_at: Date }[]>`
        UPDATE "user" SET deleted_at = now()
        WHERE id = ${id}::uuid AND deleted_at IS NULL
        RETURNING deleted_at
      `;
      return rows[0]?.deleted_at ?? null;
    },
  };
}

// Spec 11: the account export reuses this row mapper.
export { toRecord as toUserRecord };
