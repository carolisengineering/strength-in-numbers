import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  RoutineListResponseSchema,
  RoutineSchema,
  RoutineWriteSchema,
  tenthsToRpe,
  type Routine,
  type RoutineItem,
} from "@sin/core";
import {
  ExerciseRetiredError,
  NotFoundError,
  RoutineLimitError,
  RoutineNameTakenError,
} from "../errors/app-error.js";
import type { RoutineItemRecord, RoutineRecord, RoutineRepository } from "../repositories/routine.js";
import { ifNoneMatchHits, strongEtag } from "./http-cache.js";

/**
 * `routes/routines.ts` — the five routine endpoints (Spec 09 §5). Reads serve
 * a strong `ETag` over the wire JSON behind a route sentinel (§6.4, the 03.1
 * rule) and declare `config.httpCache: "revalidate"`, so the /v1 cache policy
 * sends `private, no-cache`. Writes are in the `routines` group (D14). Log
 * lines carry ids and counts only (§9) — never `name` or `notes`.
 */

export interface RoutineRouteDeps {
  routineRepository: RoutineRepository;
}

function toItemDto(r: RoutineItemRecord): RoutineItem {
  return {
    id: r.id as RoutineItem["id"],
    position: r.position,
    exerciseId: r.exerciseId as RoutineItem["exerciseId"],
    targetSets: r.targetSets,
    targetRepsLow: r.targetRepsLow,
    targetRepsHigh: r.targetRepsHigh,
    // Spec 09 D5: the one tenths → decimal conversion on this read path.
    targetRpe: r.targetRpeTenths === null ? null : tenthsToRpe(r.targetRpeTenths),
    restSeconds: r.restSeconds,
    supersetGroup: r.supersetGroup,
    notes: r.notes,
  };
}

/** Keys in `RoutineSchema` order: `JSON.stringify` of this IS the wire bytes
 * the ETag hashes (the Zod serializer has no transforms on this shape). */
function toRoutineDto(r: RoutineRecord): Routine {
  return {
    id: r.id as Routine["id"],
    name: r.name,
    notes: r.notes,
    items: r.items.map(toItemDto),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function registerRoutineRoutes(app: FastifyInstance, deps: RoutineRouteDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const idParams = z.object({ id: z.string() });

  r.get(
    "/routines",
    {
      schema: { response: { 200: RoutineListResponseSchema, 304: z.undefined() } },
      config: { published: true, problems: [], httpCache: "revalidate" },
    },
    async (request, reply) => {
      const routines = (await deps.routineRepository.list(request.user!.id)).map(toRoutineDto);
      const etag = strongEtag("routines", JSON.stringify(routines));
      reply.header("etag", etag);
      if (ifNoneMatchHits(request.headers["if-none-match"], etag)) {
        reply.code(304).send();
        return reply;
      }
      return { routines };
    },
  );

  r.get(
    "/routines/:id",
    {
      schema: { params: idParams, response: { 200: RoutineSchema, 304: z.undefined() } },
      config: { published: true, problems: [NotFoundError], httpCache: "revalidate" },
    },
    async (request, reply) => {
      const routine = toRoutineDto(await deps.routineRepository.getById(request.user!.id, request.params.id));
      const etag = strongEtag(`routine:${routine.id}`, JSON.stringify(routine));
      reply.header("etag", etag);
      if (ifNoneMatchHits(request.headers["if-none-match"], etag)) {
        reply.code(304).send();
        return reply;
      }
      return routine;
    },
  );

  r.post(
    "/routines",
    {
      schema: { body: RoutineWriteSchema, response: { 201: RoutineSchema } },
      config: {
        published: true,
        problems: [RoutineNameTakenError, RoutineLimitError, ExerciseRetiredError],
        writeGroup: "routines",
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      try {
        const created = await deps.routineRepository.create(actingUserId, request.body);
        request.log.info(
          { routine_id: created.id, user_id: actingUserId, item_count: created.items.length },
          "routine_created",
        );
        reply.code(201).header("location", `/v1/routines/${created.id}`);
        return toRoutineDto(created);
      } catch (err) {
        // §9: a product signal, not an alert.
        if (err instanceof RoutineLimitError) request.log.info({ user_id: actingUserId }, "routine_limit_hit");
        throw err;
      }
    },
  );

  r.put(
    "/routines/:id",
    {
      schema: { params: idParams, body: RoutineWriteSchema, response: { 200: RoutineSchema } },
      config: {
        published: true,
        problems: [NotFoundError, RoutineNameTakenError, ExerciseRetiredError],
        writeGroup: "routines",
      },
    },
    async (request) => {
      const actingUserId = request.user!.id;
      const updated = await deps.routineRepository.replace(actingUserId, request.params.id, request.body);
      request.log.info(
        { routine_id: updated.id, user_id: actingUserId, item_count: updated.items.length },
        "routine_updated",
      );
      return toRoutineDto(updated);
    },
  );

  r.delete(
    "/routines/:id",
    {
      schema: { params: idParams, response: { 204: z.undefined() } },
      config: { published: true, problems: [NotFoundError], writeGroup: "routines" },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      await deps.routineRepository.delete(actingUserId, request.params.id);
      request.log.info({ routine_id: request.params.id, user_id: actingUserId }, "routine_deleted");
      reply.code(204).send();
      return reply;
    },
  );
}
