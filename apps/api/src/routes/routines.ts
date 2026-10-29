import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  RoutineListResponseSchema,
  RoutineSchema,
  RoutineCreateSchema,
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

/** Spec 09.3 §9 — ids and counts only, once per read or create that removed ≥ 1 expired one-off. */
function logOneOffsExpired(log: FastifyBaseLogger, userId: string, count: number): void {
  log.info({ user_id: userId, routine_count: count }, "routine_one_offs_expired");
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
      const actingUserId = request.user!.id;
      const listed = await deps.routineRepository.list(actingUserId);
      const routines = listed.routines.map(toRoutineDto);
      if (listed.swept > 0) logOneOffsExpired(request.log, actingUserId, listed.swept);
      // Hashed over the post-sweep document, so a sweep that removed rows never answers 304 (09.3 AC22).
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
      schema: { body: RoutineCreateSchema, response: { 201: RoutineSchema } },
      config: {
        published: true,
        problems: [RoutineNameTakenError, RoutineLimitError, ExerciseRetiredError],
        writeGroup: "routines",
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      try {
        const { routine: created, swept } = await deps.routineRepository.create(actingUserId, request.body);
        if (swept > 0) logOneOffsExpired(request.log, actingUserId, swept);
        request.log.info(
          {
            routine_id: created.id,
            user_id: actingUserId,
            item_count: created.items.length,
            section_count: created.sections.length,
            planned_set_count: plannedSetCount(created),
            one_off: created.oneOffUntil !== null,
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
          section_count: updated.sections.length,
          planned_set_count: plannedSetCount(updated),
        },
        "routine_updated",
      );
      return toRoutineDto(updated);
    },
  );

  // Spec 09.3 §5 — no body: the web sends none and no content-type (AC10).
  r.post(
    "/routines/:id/keep",
    {
      schema: { params: idParams, response: { 204: z.undefined() } },
      config: { published: true, problems: [NotFoundError], writeGroup: "routines" },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const { changed } = await deps.routineRepository.keep(actingUserId, request.params.id);
      request.log.info({ routine_id: request.params.id, user_id: actingUserId, changed }, "routine_kept");
      reply.code(204).send();
      return reply;
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
