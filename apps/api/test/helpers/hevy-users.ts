import type { FastifyBaseLogger } from "fastify";
import type { HevyRepository } from "../../src/repositories/hevy.js";
import type { HevyImportRepository } from "../../src/repositories/hevy-import.js";
import type { RateLimitConfig } from "../../src/plugins/rate-limit.js";
import { buildTestApp, testConfig } from "./build-test-app.js";
import { FakeUserRepository, authContext, fakeVerifier, makeUser } from "./fakes.js";

/** Spec 19.0: user A is on the Hevy allow-list, user B is not. Token "a" signs in as A, "b" as B. */
export const USER_A = "0192a1b2-0000-7000-8000-0000000000aa";
export const USER_B = "0192a1b2-0000-7000-8000-0000000000bb";
export const AS_A = { authorization: "Bearer a" };
export const AS_B = { authorization: "Bearer b" };

export async function buildHevyApp(opts: {
  hevyRepository?: HevyRepository;
  hevyImportRepository?: HevyImportRepository;
  rateLimits?: RateLimitConfig;
  logger?: FastifyBaseLogger;
  deletedA?: boolean;
} = {}) {
  const users = new FakeUserRepository([
    makeUser({ id: USER_A, authSub: "auth0|a", deletedAt: opts.deletedA ? new Date("2026-10-01T00:00:00.000Z") : null }),
    makeUser({ id: USER_B, authSub: "auth0|b" }),
  ]);
  return buildTestApp({
    config: { ...testConfig(), hevyEnabledUserIds: Object.freeze(new Set([USER_A])) },
    userRepository: users,
    tokenVerifier: fakeVerifier((token) => authContext({ authSub: token === "a" ? "auth0|a" : "auth0|b" })),
    ...(opts.hevyRepository ? { hevyRepository: opts.hevyRepository } : {}),
    ...(opts.hevyImportRepository ? { hevyImportRepository: opts.hevyImportRepository } : {}),
    ...(opts.rateLimits ? { rateLimits: opts.rateLimits } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}
