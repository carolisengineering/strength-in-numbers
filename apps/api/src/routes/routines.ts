import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  RoutineListResponseSchema,
  RoutineSchema,
  RoutineWriteSchema,
} from "@sin/core";
import {
  ExerciseRetiredError,
  NotFoundError,
  RoutineLimitError,
  RoutineNameTakenError,
} from "../errors/app-error.js";
import type { RoutineRecord, RoutineRepository } from "../repositories/routine.js";
import { ifNoneMatchHits, strongEtag } from "./http-cache.js";
import { toRoutineDto } from "./mappers.js";

/**
 * `routes/routines.ts` — the five routine endpoints (Spec 09 §5). Reads serve
 * a strong `ETag` over the wire JSON behind a route sentinel (§6.4, the 03.1
 * rule) and declare `config.httpCache: "revalidate"`, so the /v1 cache policy
 * sends `private, no-cache`. Writes are in the `routines` group (D14). Log
 * lines carry ids and counts only (§9) — never `name` or `notes`.
 */

/** Spec 09.1 §6.6 / D9: a legal maximum routine (30 items × 20 planned sets,
 * full notes) is ~74 KB, over the global BODY_LIMIT_BYTES (64 KiB, app.ts).
 * Only the two routine writes get more; every other route keeps 64 KiB. */
export const ROUTINE_BODY_LIMIT_BYTES = 128 * 1024;

export interface RoutineRouteDeps {
  routineRepository: RoutineRepository;
}

const plannedSetCount = (r: RoutineRecord): number => r.items.reduce((n, it) => n + it.sets.length, 0);

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
      bodyLimit: ROUTINE_BODY_LIMIT_BYTES,
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
          {
            routine_id: created.id,
            user_id: actingUserId,
            item_count: created.items.length,
            planned_set_count: plannedSetCount(created),
          },
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
      bodyLimit: ROUTINE_BODY_LIMIT_BYTES,
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
        {
          routine_id: updated.id,
          user_id: actingUserId,
          item_count: updated.items.length,
          planned_set_count: plannedSetCount(updated),
        },
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
