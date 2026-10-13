import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ACCOUNT_PURGE_GRACE_DAYS, AccountDeletedResponseSchema } from "@sin/core";
import { AccountDeletedError } from "../errors/app-error.js";
import type { UserRepository } from "../repositories/user.js";

/**
 * `routes/account.ts` — Spec 11 §5. The account acted on is always
 * `request.user`, never client input (§7). Log lines carry `user_id` and
 * counts only.
 */

export interface AccountRouteDeps {
  userRepository: UserRepository;
}

const DAY_MS = 86_400_000;

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // §6.3: one guarded UPDATE. resolveUser has already 403'd a deleted account;
  // a delete that loses a race matches zero rows and gets the same 403 (D9).
  r.delete(
    "/account",
    {
      schema: { response: { 202: AccountDeletedResponseSchema } },
      config: { published: true, problems: [], writeGroup: "me" },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const deletedAt = await deps.userRepository.markDeleted(userId);
      if (deletedAt === null) throw new AccountDeletedError("account deleted by a concurrent request");
      // D17: the one durable record of when the delete happened.
      request.log.info({ user_id: userId }, "account_deleted");
      reply.code(202);
      return {
        deletedAt: deletedAt.toISOString(),
        // D10: exact milliseconds, no calendar arithmetic.
        purgeEligibleAt: new Date(deletedAt.getTime() + ACCOUNT_PURGE_GRACE_DAYS * DAY_MS).toISOString(),
      };
    },
  );
}
