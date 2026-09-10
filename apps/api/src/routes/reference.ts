import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  EquipmentResponse,
  MuscleGroupsResponse,
  type Equipment,
  type MuscleGroup,
} from "@sin/core";
import type { ReferenceRecord } from "../repositories/exercise.js";
import type { ExerciseRepository } from "../repositories/exercise.js";
import { addVary, ifNoneMatchHits, strongEtag } from "./http-cache.js";

/**
 * `GET /v1/muscle-groups` and `GET /v1/equipment` — the reference tables served
 * separately from the catalog (Spec 03.1 §5, §6.2). Each is the full table as
 * `camelCase` DTOs, ordered by `display_order` then `id COLLATE "C"` in the
 * repository, with its own strong content `ETag` / `304` and the same
 * `Cache-Control: private, no-cache` + `Vary: Authorization` headers as
 * `/v1/exercises` (the data is user-independent, but the response is auth-gated,
 * so shared caching stays off for consistency). No `updated_since` — the tables
 * are tiny and change only on a deploy, so a client re-fetches whenever its
 * `If-None-Match` check misses.
 */

export interface ReferenceRouteDeps {
  exerciseRepository: ExerciseRepository;
}

/** DB record → wire DTO. `MuscleGroup` and `Equipment` share this shape (§5). */
function toDto(r: ReferenceRecord): MuscleGroup & Equipment {
  return { id: r.id, name: r.name, displayOrder: r.displayOrder };
}

/**
 * Set the cache headers + strong `ETag` (namespaced by `sentinel` — the payload
 * key — so the two reference endpoints can never share a validator), then either
 * `304` with an empty body or hand the body back for the type provider to
 * serialize.
 */
function serveReference<B extends object>(
  request: { headers: Record<string, string | string[] | undefined> },
  reply: FastifyReply,
  sentinel: string,
  rows: (MuscleGroup & Equipment)[],
  body: B,
): B | FastifyReply {
  const etag = strongEtag(sentinel, JSON.stringify(rows));

  reply.header("cache-control", "private, no-cache");
  addVary(reply, "Authorization");
  reply.header("etag", etag);

  if (ifNoneMatchHits(request.headers["if-none-match"], etag)) {
    reply.code(304).send();
    return reply;
  }
  return body;
}

export function registerReferenceRoutes(
  app: FastifyInstance,
  deps: ReferenceRouteDeps,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/muscle-groups",
    { schema: { response: { 200: MuscleGroupsResponse, 304: z.undefined() } } },
    async (request, reply) => {
      const muscleGroups = (
        await deps.exerciseRepository.listMuscleGroups()
      ).map(toDto);
      return serveReference(request, reply, "muscleGroups", muscleGroups, {
        muscleGroups,
      });
    },
  );

  r.get(
    "/equipment",
    { schema: { response: { 200: EquipmentResponse, 304: z.undefined() } } },
    async (request, reply) => {
      const equipment = (await deps.exerciseRepository.listEquipment()).map(
        toDto,
      );
      return serveReference(request, reply, "equipment", equipment, {
        equipment,
      });
    },
  );
}
