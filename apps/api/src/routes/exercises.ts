import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  ExercisesResponse,
  UpdatedSinceQuery,
  type Exercise,
} from "@sin/core";
import type { ExerciseRecord } from "../repositories/exercise.js";
import type { ExerciseRepository } from "../repositories/exercise.js";
import { ifNoneMatchHits, strongEtag } from "./http-cache.js";

/**
 * `GET /v1/exercises` (+ the Fastify-generated `HEAD`) — the caller-visible
 * catalog as a full pull or an `updated_since` delta (Spec 03.1 §5, §6.1).
 *
 * - No `updated_since` → `findVisibleCatalog` (active rows only).
 * - `updated_since=<rfc3339>` → `findCatalogDelta` (includes tombstones); a
 *   malformed value is rejected as `422 validation-error` by the Zod
 *   querystring schema via the Spec 03.0 error mapping.
 * - **`ETag`** is `sha256(<cursor-sentinel> ‖ <exercises wire bytes>)`, first 32
 *   hex, strong. `serverTime` is deliberately *not* in the hash, so a later
 *   `serverTime` over an unchanged catalog yields the same `ETag` and
 *   `If-None-Match` produces a `304`. The sentinel — the `updated_since` value
 *   on a delta, `"full"` otherwise — stops a delta that serializes to the same
 *   bytes as an earlier full pull from returning a spurious `304`.
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
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** `sha256(<cursor-sentinel> ‖ <exercises wire bytes>)`, first 32 hex, strong.
 * The sentinel is the `updated_since` value on a delta, `"full"` otherwise. */
function catalogEtag(sentinel: string, exercises: Exercise[]): string {
  return strongEtag(sentinel, JSON.stringify(exercises));
}

export function registerExerciseRoutes(
  app: FastifyInstance,
  deps: ExerciseRouteDeps,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/exercises",
    {
      schema: {
        querystring: UpdatedSinceQuery,
        response: { 200: ExercisesResponse },
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const updatedSince = request.query.updated_since;

      const page = updatedSince
        ? await deps.exerciseRepository.findCatalogDelta(
            actingUserId,
            updatedSince,
          )
        : await deps.exerciseRepository.findVisibleCatalog(actingUserId);

      const exercises = page.rows.map(toDto);
      const etag = catalogEtag(updatedSince ?? "full", exercises);

      reply.header("cache-control", "private, no-cache");
      reply.header("vary", "Authorization");
      reply.header("etag", etag);

      if (ifNoneMatchHits(request.headers["if-none-match"], etag)) {
        // 304 carries no body; step outside the type provider's 200-payload
        // narrowing to send an empty response.
        (reply as FastifyReply).code(304).send();
        return reply;
      }

      return { exercises, serverTime: page.serverTime.toISOString() };
    },
  );
}
