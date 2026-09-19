import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CatalogSinceQuery,
  CreateExerciseSchema,
  ExercisesResponse,
  ExerciseSchema,
  UpdateExerciseSchema,
  type Exercise,
} from "@sin/core";
import type { ExerciseRecord } from "../repositories/exercise.js";
import type { ExerciseRepository } from "../repositories/exercise.js";
import { parseSyncToken } from "../repositories/sync-token.js";
import { addVary, ifNoneMatchHits, strongEtag } from "./http-cache.js";

/**
 * `GET /v1/exercises` (+ the Fastify-generated `HEAD`) — the caller-visible
 * catalog as a full pull or a `since` delta (Spec 03.1 §5, Spec 03.3 §5, §6).
 *
 * - No `since` → `findCatalog(user)` (active rows only).
 * - `since=<syncToken>` → `findCatalog(user, xid)` (includes tombstones); a
 *   malformed value is rejected as `422 validation-error` by the Zod
 *   querystring schema (Spec 03.0 error mapping), and a token ahead of the
 *   server's snapshot is a `410 sync-token-expired` thrown by the repository.
 *   A stale `?updated_since=` is an unknown key: ignored, i.e. a full pull.
 * - **`ETag`** is `sha256(<cursor-sentinel> ‖ <exercises wire bytes>)`, first 32
 *   hex, strong. `syncToken` is deliberately *not* in the hash, so a later
 *   `syncToken` over an unchanged catalog yields the same `ETag` and
 *   `If-None-Match` produces a `304`. The sentinel — the `since` token on a
 *   delta, `"full"` otherwise — stops a delta that serializes to the same bytes
 *   as an earlier full pull from returning a spurious `304`.
 * - Every `200` and `304` carries `Cache-Control: private, no-cache` +
 *   `Vary: Authorization`: the payload is per-caller (custom rows join it in
 *   03.2), so no shared cache may reuse it across users (§7).
 */

export interface ExerciseRouteDeps {
  exerciseRepository: ExerciseRepository;
}

/** DB record → wire DTO, keys in `ExerciseSchema` field order (§5). The `id` /
 * `ownerUserId` brands and the `modality` enum are guaranteed by the schema +
 * the DB `CHECK`, so they are asserted here rather than re-parsed. */
function toDto(r: ExerciseRecord): Exercise {
  return {
    id: r.id as Exercise["id"],
    catalogKey: r.catalogKey,
    ownerUserId: r.ownerUserId as Exercise["ownerUserId"],
    name: r.name,
    modality: r.modality as Exercise["modality"],
    primaryMuscleId: r.primaryMuscleId,
    secondaryMuscleIds: r.secondaryMuscleIds,
    equipmentId: r.equipmentId,
    isActive: r.isActive,
    forkedFromExerciseId: r.forkedFromExerciseId as Exercise["forkedFromExerciseId"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** `sha256(<cursor-sentinel> ‖ <exercises wire bytes>)`, first 32 hex, strong.
 * The sentinel is the `since` token on a delta, `"full"` otherwise. */
function catalogEtag(sentinel: string, exercises: Exercise[]): string {
  return strongEtag(sentinel, JSON.stringify(exercises));
}

export function registerExerciseRoutes(
  app: FastifyInstance,
  deps: ExerciseRouteDeps,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const exerciseIdParams = z.object({ id: z.string() });

  r.get(
    "/exercises",
    {
      schema: {
        querystring: CatalogSinceQuery,
        response: { 200: ExercisesResponse, 304: z.undefined() },
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const since = request.query.since;

      const page = await deps.exerciseRepository.findCatalog(
        actingUserId,
        since === undefined ? undefined : parseSyncToken(since),
      );

      const exercises = page.rows.map(toDto);
      const etag = catalogEtag(since ?? "full", exercises);

      reply.header("cache-control", "private, no-cache");
      addVary(reply, "Authorization");
      reply.header("etag", etag);

      if (ifNoneMatchHits(request.headers["if-none-match"], etag)) {
        // 304 carries no body; step outside the type provider's 200-payload
        // narrowing to send an empty response.
        reply.code(304).send();
        return reply;
      }

      return { exercises, syncToken: page.syncToken };
    },
  );

  r.post(
    "/exercises",
    { schema: { body: CreateExerciseSchema, response: { 201: ExerciseSchema } } },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const created = await deps.exerciseRepository.createExercise(
        actingUserId,
        request.body,
      );
      request.log.info(
        { exercise_id: created.id, owner_user_id: actingUserId },
        "custom_exercise_created",
      );
      reply.code(201).header("location", `/v1/exercises/${created.id}`);
      return toDto(created);
    },
  );

  r.patch(
    "/exercises/:id",
    {
      schema: {
        params: exerciseIdParams,
        body: UpdateExerciseSchema,
        response: { 200: ExerciseSchema },
      },
    },
    async (request) => {
      const actingUserId = request.user!.id;
      const updated = await deps.exerciseRepository.updateExercise(
        actingUserId,
        request.params.id,
        request.body,
      );
      request.log.info(
        { exercise_id: updated.id, owner_user_id: actingUserId },
        "custom_exercise_updated",
      );
      return toDto(updated);
    },
  );

  // The overlay body is optional (Spec 03.2 §1, §5): "fork this global
  // exercise unchanged" is the primary use case, so a bodiless request must
  // 201 rather than 422. Fastify hands a truly bodiless request to the
  // validator as `null` (not `undefined`) when no content type parser ran,
  // so this needs `.nullish()` (accepts both `undefined` and `null`), not
  // just `.optional()` — `.default({})` then coerces either into `{}` while
  // still 422ing an invalid overlay (e.g. an unrecognized key, or `name: ""`).
  const forkBodySchema = UpdateExerciseSchema.nullish().default({});

  r.post(
    "/exercises/:id/fork",
    {
      schema: {
        params: exerciseIdParams,
        body: forkBodySchema,
        response: { 201: ExerciseSchema },
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const forked = await deps.exerciseRepository.forkExercise(
        actingUserId,
        request.params.id,
        request.body ?? {},
      );
      request.log.info(
        {
          exercise_id: forked.id,
          owner_user_id: actingUserId,
          forked_from_exercise_id: forked.forkedFromExerciseId,
        },
        "custom_exercise_forked",
      );
      reply.code(201).header("location", `/v1/exercises/${forked.id}`);
      return toDto(forked);
    },
  );

  r.delete(
    "/exercises/:id",
    { schema: { params: exerciseIdParams, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      await deps.exerciseRepository.deleteExercise(actingUserId, request.params.id);
      request.log.info(
        { exercise_id: request.params.id, owner_user_id: actingUserId },
        "custom_exercise_deleted",
      );
      reply.code(204).send();
      return reply;
    },
  );
}
