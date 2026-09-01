import type { AuthContext } from "./verify.js";
import type { UserRecord, UserRepository } from "../repositories/user.js";
import { AccountDeletedError, InvalidTokenError } from "../errors/app-error.js";

/**
 * User provisioning (Spec 01 §6.2).
 *
 * Runs after token verification for every `/v1/*` app route (not `/v1/_authcheck`).
 *   - unknown sub  → require an `email` claim, insert-or-noop, re-read
 *   - deleted_at   → 403 account-deleted
 *   - email drift  → cheap re-sync so an IdP-side change propagates
 */

export interface ResolvedUser {
  user: UserRecord;
  isNewUser: boolean;
}

export async function resolveUser(
  repo: UserRepository,
  auth: AuthContext,
): Promise<ResolvedUser> {
  let user = await repo.findByAuthSub(auth.authSub);
  let isNewUser = false;

  if (!user) {
    if (auth.email === undefined) {
      // Spec 01 §6.2 / §5: reject rather than store a null email.
      throw new InvalidTokenError(
        "token has no email claim; cannot provision user",
      );
    }
    const provisioned = await repo.provision({
      authSub: auth.authSub,
      email: auth.email,
      emailVerified: auth.emailVerified ?? false,
    });
    user = provisioned.user;
    isNewUser = provisioned.isNewUser;
  }

  if (user.deletedAt !== null) {
    throw new AccountDeletedError();
  }

  if (auth.email !== undefined) {
    const targetVerified = auth.emailVerified ?? user.emailVerified;
    if (user.email !== auth.email || user.emailVerified !== targetVerified) {
      user = await repo.syncEmail(user.id, auth.email, targetVerified);
    }
  }

  return { user, isNewUser };
}
