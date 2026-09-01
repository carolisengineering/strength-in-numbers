import type { PrismaClient, User as PrismaUser } from "@prisma/client";
import { uuidv7 } from "uuidv7";
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
 * (Spec 01 criterion 8). It is the single spot in M0 that drops to raw SQL.
 */

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

export function createUserRepository(prisma: PrismaClient): UserRepository {
  return {
    async findByAuthSub(authSub: string): Promise<UserRecord | null> {
      const row = await prisma.user.findUnique({ where: { authSub } });
      return row ? toRecord(row) : null;
    },

    async provision(input: ProvisionInput): Promise<ProvisionResult> {
      const id = uuidv7();
      const inserted = await prisma.$executeRaw`
        INSERT INTO "user" ("id", "auth_sub", "email", "email_verified")
        VALUES (${id}::uuid, ${input.authSub}, ${input.email}, ${input.emailVerified})
        ON CONFLICT ("auth_sub") DO NOTHING
      `;
      const row = await prisma.user.findUnique({
        where: { authSub: input.authSub },
      });
      if (!row) {
        throw new Error("provision: user row missing after upsert + re-read");
      }
      return { user: toRecord(row), isNewUser: inserted === 1 };
    },

    async syncEmail(
      id: string,
      email: string,
      emailVerified: boolean,
    ): Promise<UserRecord> {
      const row = await prisma.user.update({
        where: { id },
        data: { email, emailVerified, updatedAt: new Date() },
      });
      return toRecord(row);
    },

    async updateProfile(
      id: string,
      patch: ProfilePatch,
    ): Promise<UserRecord> {
      const row = await prisma.user.update({
        where: { id },
        data: {
          ...(patch.displayName !== undefined
            ? { displayName: patch.displayName }
            : {}),
          ...(patch.unitPreference !== undefined
            ? { unitPreference: patch.unitPreference }
            : {}),
          ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
          updatedAt: new Date(),
        },
      });
      return toRecord(row);
    },
  };
}
