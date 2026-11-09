import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import type { RateLimitConfig } from "../../src/plugins/rate-limit.js";
import { appRepositories, type AppIntegrationDb, type IntegrationDb } from "./helpers.js";

/** Every bearer token maps to `auth0|<token>` — so two tokens can share a sub
 * by passing `{ "tok-a2": "auth0|tok-a" }` in `alias`. */
export function makeAccountApp(
  db: AppIntegrationDb,
  opts: { alias?: Record<string, string>; rateLimits?: RateLimitConfig; logger?: false } = {},
): Promise<FastifyInstance> {
  return buildApp({
    config: testConfig(),
    logger: opts.logger ?? false,
    checkReadiness: () => checkDatabaseReady(db.app),
    tokenVerifier: fakeVerifier((token) => {
      const sub = opts.alias?.[token] ?? `auth0|${token}`;
      return authContext({ authSub: sub, email: `${sub.slice(6)}@ex.com` });
    }),
    ...appRepositories(db.app),
    rateLimits: opts.rateLimits ?? GENEROUS_LIMITS,
  });
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export const TRUNCATE_ACCOUNTS =
  'TRUNCATE "personal_record", "set_entry", "workout_exercise", "workout_section", "workout", "routine_item", "routine_section", "routine", "exercise", "user" CASCADE';

/** md5 of every row of `table` (as JSON, minus `omit` keys), ordered by id. */
export async function tableHash(db: IntegrationDb, table: string, omit: string[] = []): Promise<string> {
  const minus = omit.map((k) => ` - '${k}'`).join("");
  const rows = await db.prisma.$queryRawUnsafe<{ h: string | null }[]>(
    // Spec 19.0: the id-less hevy tables order by their whole content.
    `SELECT md5(string_agg((to_jsonb(t)${minus})::text, ',' ORDER BY COALESCE(to_jsonb(t)->>'id', to_jsonb(t)::text))) AS h FROM "${table}" t`,
  );
  return rows[0]!.h ?? "empty";
}

export const USER_TABLES = [
  "user", "exercise", "workout", "workout_exercise", "set_entry", "routine", "routine_item", "personal_record",
  "routine_item_set", "workout_planned_set", // Spec 09.1
  "routine_section", "workout_section", // Spec 09.2
  "hevy_exercise_pair", "hevy_section_rule", "hevy_link", "hevy_account", // Spec 19.0
] as const;
