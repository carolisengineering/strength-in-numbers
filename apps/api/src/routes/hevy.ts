import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  HevyLinkBeginBodySchema,
  HevyLinkBeginSchema,
  HevyLinkCompleteSchema,
  HevyLinkStateSchema,
  HevyMappingPatchSchema,
  HevyMappingPutSchema,
  HevyMappingSchema,
  HevyStatusSchema,
} from "@sin/core";
import {
  HevyIdInUseError,
  HevyLinkConflictError,
  HevyNoClaimError,
  HevySendInProgressError,
  HevyWorkoutNotFinishedError,
  NotFoundError,
} from "../errors/app-error.js";
import { hevyFingerprint } from "../hevy/fingerprint.js";
import type { HevyRepository } from "../repositories/hevy.js";
import { ifNoneMatchHits, strongEtag } from "./http-cache.js";

export interface HevyRouteDeps {
  hevyRepository: HevyRepository;
  hevyEnabledUserIds: ReadonlySet<string>;
}

/** Spec 19.0 AC23: the mapping replace's request-body limit. */
export const HEVY_MAPPING_BODY_LIMIT = 512 * 1024;

const workoutIdParams = z.object({ id: z.string() });
// A 422 (`ValidationError`) is implicit on every route with a body, as on every other route.

/**
 * Spec 19.0 §5, §6.1: the owner-only Hevy routes, in their own child of the `/v1` scope. Its `onRequest` gate runs
 * after the parent's auth `onRequest` (so a deleted account still gets `403 account-deleted` first) and before the
 * write-group limit (`preParsing`) and body parsing, so a user not on `HEVY_ENABLED_USER_IDS` gets exactly the `404`
 * of an unknown route, never a `413` / `400` / `422` / `429` that would show the route exists. No route is published.
 */
export function registerHevyRoutes(app: FastifyInstance, deps: HevyRouteDeps): void {
  app.register(async (scope) => {
    scope.addHook("onRequest", async (request: FastifyRequest) => {
      if (!request.user || !deps.hevyEnabledUserIds.has(request.user.id)) {
        // The same internal text as the unknown-route handler (errors/contract.ts), so even the log line matches.
        throw new NotFoundError(`route ${request.method} ${request.url} not found`);
      }
    });

    const r = scope.withTypeProvider<ZodTypeProvider>();
    const repo = deps.hevyRepository;

    r.get(
      "/hevy/status",
      { schema: { response: { 200: HevyStatusSchema } }, config: { problems: [NotFoundError] } },
      async (request) => ({ enabled: true as const, ...(await repo.status(request.user!.id)) }),
    );

    r.get(
      "/hevy/mapping",
      {
        schema: { response: { 200: HevyMappingSchema, 304: z.undefined() } },
        config: { problems: [NotFoundError], httpCache: "revalidate" },
      },
      async (request, reply) => {
        const mapping = await repo.getMapping(request.user!.id);
        const etag = strongEtag("hevy-mapping", JSON.stringify(mapping));
        reply.header("etag", etag);
        if (ifNoneMatchHits(request.headers["if-none-match"], etag)) {
          reply.code(304).send();
          return reply;
        }
        return mapping;
      },
    );

    r.put(
      "/hevy/mapping",
      {
        bodyLimit: HEVY_MAPPING_BODY_LIMIT,
        schema: { body: HevyMappingPutSchema, response: { 200: HevyMappingSchema } },
        config: { writeGroup: "hevy", problems: [NotFoundError] },
      },
      async (request) => {
        const mapping = await repo.replaceMapping(request.user!.id, request.body);
        // AC37: counts only; never a Hevy title, a Hevy id or an exercise name.
        request.log.info(
          { user_id: request.user!.id, pairs: mapping.pairs.length, section_rules: mapping.sectionRules.length },
          "hevy_mapping_replaced",
        );
        return mapping;
      },
    );

    r.patch(
      "/hevy/mapping",
      {
        schema: { body: HevyMappingPatchSchema, response: { 200: HevyMappingSchema } },
        config: { writeGroup: "hevy", problems: [NotFoundError] },
      },
      async (request) => {
        const mapping = await repo.patchMapping(request.user!.id, request.body);
        request.log.info(
          {
            user_id: request.user!.id,
            upserts: request.body.upsert?.length ?? 0,
            removals: request.body.remove?.length ?? 0,
            pairs: mapping.pairs.length,
          },
          "hevy_mapping_patched",
        );
        return mapping;
      },
    );

    r.get(
      "/workouts/:id/hevy-link",
      { schema: { params: workoutIdParams, response: { 200: HevyLinkStateSchema } }, config: { problems: [NotFoundError] } },
      async (request) => repo.readLink(request.user!.id, request.params.id),
    );

    r.post(
      "/workouts/:id/hevy-link",
      {
        schema: { params: workoutIdParams, body: HevyLinkBeginBodySchema.optional(), response: { 200: HevyLinkBeginSchema } },
        config: { writeGroup: "hevy", problems: [NotFoundError, HevySendInProgressError, HevyWorkoutNotFinishedError] },
      },
      async (request) => {
        const begun = await repo.beginLink(request.user!.id, request.params.id, { relink: request.body?.relink === true });
        return { mode: begun.mode, hevyWorkoutId: begun.hevyWorkoutId, staleClaim: begun.staleClaim, fingerprint: hevyFingerprint(begun.source) };
      },
    );

    r.put(
      "/workouts/:id/hevy-link",
      {
        schema: { params: workoutIdParams, body: HevyLinkCompleteSchema, response: { 200: HevyLinkStateSchema } },
        config: {
          writeGroup: "hevy",
          problems: [NotFoundError, HevyNoClaimError, HevyLinkConflictError, HevyIdInUseError],
        },
      },
      async (request) => repo.completeLink(request.user!.id, request.params.id, request.body),
    );

    r.delete(
      "/workouts/:id/hevy-link",
      {
        schema: { params: workoutIdParams, response: { 204: z.undefined() } },
        config: { writeGroup: "hevy", problems: [NotFoundError] },
      },
      async (request, reply) => {
        await repo.releaseLink(request.user!.id, request.params.id);
        reply.code(204).send();
        return reply;
      },
    );
  });
}
