import { NotFoundError } from "../errors/app-error.js";

/**
 * User repository contract (Spec 01 §3, §6.3).
 *
 * All `user` access goes through this interface — no inline queries in handlers,
 * so later specs have one place to add visibility checks (DESIGN R8). The Prisma
 * implementation lives in ./user.prisma.ts; tests use a fake.
 */

export type UnitPreference = "kg" | "lb";

export interface UserRecord {
  id: string;
  authSub: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  unitPreference: UnitPreference;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProvisionInput {
  authSub: string;
  email: string;
  emailVerified: boolean;
}

export interface ProvisionResult {
  user: UserRecord;
  /** True only for the call that actually inserted the row. */
  isNewUser: boolean;
}

export interface ProfilePatch {
  displayName?: string | null;
  unitPreference?: UnitPreference;
  timezone?: string;
}

export interface UserRepository {
  findByAuthSub(authSub: string): Promise<UserRecord | null>;
  /** Insert-or-noop keyed by `auth_sub`, then re-read the winning row. */
  provision(input: ProvisionInput): Promise<ProvisionResult>;
  syncEmail(
    id: string,
    email: string,
    emailVerified: boolean,
  ): Promise<UserRecord>;
  updateProfile(id: string, patch: ProfilePatch): Promise<UserRecord>;
}

export function assertOwned<T extends { userId: string }>(
  row: T | null | undefined,
  actingUserId: string,
): T {
  if (!row || row.userId !== actingUserId) {
    // 404, not 403 — existence must not leak (Spec 01 §6.3).
    throw new NotFoundError("resource not found or not owned by the acting user");
  }
  return row;
}
