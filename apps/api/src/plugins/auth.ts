import fp from "fastify-plugin";
import {
  parseAuthorizationHeader,
  type AuthContext,
  type TokenVerifier,
} from "../auth/verify.js";
import { resolveUser } from "../auth/provisioning.js";
import type { UserRecord, UserRepository } from "../repositories/user.js";
import { problemResponse } from "../errors/problem.js";

/**
 * Auth boundary for `/v1/*` (Spec 01 §6.1, §6.2).
 *
 * onRequest: parse bearer → verify token → attach `request.auth`. Unless the
 * route opts out (`config.skipProvisioning`, used only by `/v1/_authcheck`),
 * also resolve/provision the `user` row and attach `request.user`. Any failure
 * is rendered as problem+json before the handler runs.
 */

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    user?: UserRecord;
    isNewUser?: boolean;
  }
  interface FastifyContextConfig {
    skipProvisioning?: boolean;
  }
}

export interface AuthPluginDeps {
  tokenVerifier: TokenVerifier;
  userRepository: UserRepository;
}

export const authPlugin = fp<AuthPluginDeps>(
  async (app, opts) => {
    const { tokenVerifier, userRepository } = opts;

    app.addHook("onRequest", async (request, reply) => {
      try {
        const token = parseAuthorizationHeader(request.headers.authorization);
        request.auth = await tokenVerifier.verify(token);

        if (request.routeOptions.config?.skipProvisioning === true) {
          return;
        }

        const { user, isNewUser } = await resolveUser(
          userRepository,
          request.auth,
        );
        request.user = user;
        request.isNewUser = isNewUser;
        (
          request.log as {
            setBindings?: (b: Record<string, unknown>) => void;
          }
        ).setBindings?.({ user_id: user.id });
      } catch (err) {
        return problemResponse(reply, err);
      }
    });
  },
  { name: "auth" },
);
