import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CatalogSinceQuery,
  CreateExerciseSchema,
  ExercisesResponse,
  ExerciseRoutinesResponseSchema,
  ExerciseSchema,
  ExerciseUsageResponseSchema,
  type ExerciseRoutineRef,
  type ExerciseUsage,
  UpdateExerciseSchema,
  type Exercise,
} from "@sin/core";
import {
  CustomExerciseLimitError,
  ExerciseAlreadyOwnedError,
  ExerciseImmutableError,
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  ExerciseTypeLockedError,
  NotFoundError,
  SyncTokenExpiredError,
} from "../errors/app-error.js";
import { toExerciseDto } from "./mappers.js";
import type { ExerciseRepository } from "../repositories/exercise.js";
import { parseSyncToken } from "../repositories/sync-token.js";
import { ifNoneMatchHits, strongEtag } from "./http-cache.js";

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
 * - `config.httpCache: "revalidate"` → every `200` and `304` carries
 *   `Cache-Control: private, no-cache` (set by the `/v1` cache policy,
 *   `plugins/cache-policy.ts`; errors get `no-store`). `private` keeps the
 *   per-caller payload out of every shared cache (§7); there is no
 *   `Vary: Authorization` (#17).
 */

export interface ExerciseRouteDeps {
  exerciseRepository: ExerciseRepository;
}

/** `sha256(<cursor-sentinel> ‖ <exercises wire bytes>)`, first 32 hex, strong.
 * The sentinel is the `since` token on a delta, `"full"` otherwise.
 * `JSON.stringify(exercises)` *is* the wire bytes: the Zod serializer sends
 * `JSON.stringify(safeEncode(ExerciseSchema[], …))`, the schema has no transforms,
 * and `toExerciseDto` emits keys in schema order — pinned by the #20 route test, so keep
 * `toExerciseDto` in schema order (Spec 03.1 §6.1 step 3). */
function catalogEtag(sentinel: string, exercises: Exercise[]): string {
  return strongEtag(sentinel, JSON.stringify(exercises));
}

/**
 * Spec 03.4 AC20: a refused type change is a lifter's mistake, so it is logged at `info`, once, with ids and enum
 * values only (never a name), and rethrown for the problem mapper.
 */
async function logTypeRefusal<T>(request: FastifyRequest, exerciseId: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof ExerciseTypeLockedError) {
      request.log.info(
        { exercise_id: exerciseId, owner_user_id: request.user!.id, from_modality: err.fromModality, to_modality: err.toModality },
        "custom_exercise_type_change_refused",
      );
    }
    throw err;
  }
}

export function registerExerciseRoutes(
  app: FastifyInstance,
  deps: ExerciseRouteDeps,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const exerciseIdParams = z.object({ id: z.string() });

  // Spec 03.4 §5.2: last logged per lineage root. Static path: find-my-way matches it before `/exercises/:id`.
  r.get(
    "/exercises/usage",
    {
      schema: { response: { 200: ExerciseUsageResponseSchema, 304: z.undefined() } },
      config: { published: true, problems: [], httpCache: "revalidate" },
    },
    async (request, reply) => {
      const exercises = (await deps.exerciseRepository.findUsage(request.user!.id)).map((u) => ({
        rootId: u.rootId as ExerciseUsage["rootId"],
        lastLoggedOn: u.lastLoggedOn,
      }));
      const etag = strongEtag("exercise-usage", JSON.stringify(exercises));
      reply.header("etag", etag);
      if (ifNoneMatchHits(request.headers["if-none-match"], etag)) {
        reply.code(304).send();
        return reply;
      }
      return { exercises };
    },
  );

  // Spec 03.4 §5.1: the delete warning's list. no-store (no httpCache), a read (no writeGroup), never sweeps one-offs.
  r.get(
    "/exercises/:id/routines",
    {
      schema: { params: exerciseIdParams, response: { 200: ExerciseRoutinesResponseSchema } },
      config: { published: true, problems: [NotFoundError] },
    },
    async (request) => {
      const routines = await deps.exerciseRepository.listRoutinesUsing(request.user!.id, request.params.id);
      return { routines: routines.map((r) => ({ id: r.id as ExerciseRoutineRef["id"], name: r.name, oneOffUntil: r.oneOffUntil?.toISOString() ?? null })) };
    },
  );

  r.get(
    "/exercises",
    {
      schema: {
        querystring: CatalogSinceQuery,
        response: { 200: ExercisesResponse, 304: z.undefined() },
      },
      config: { published: true, problems: [SyncTokenExpiredError], httpCache: "revalidate" },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const since = request.query.since;

      const page = await deps.exerciseRepository.findCatalog(
        actingUserId,
        since === undefined ? undefined : parseSyncToken(since),
      );

      const exercises = page.rows.map(toExerciseDto);
      const etag = catalogEtag(since ?? "full", exercises);

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
    {
      schema: { body: CreateExerciseSchema, response: { 201: ExerciseSchema } },
      config: { published: true, problems: [CustomExerciseLimitError], writeGroup: "exercises" },
    },
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
      return toExerciseDto(created);
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
      config: {
        published: true,
        problems: [NotFoundError, ExerciseImmutableUseForkError, ExerciseRetiredError, ExerciseTypeLockedError],
        writeGroup: "exercises",
      },
    },
    async (request) => {
      const actingUserId = request.user!.id;
      const { exercise: updated, modalityChanged } = await logTypeRefusal(request, request.params.id, () =>
        deps.exerciseRepository.updateExercise(actingUserId, request.params.id, request.body),
      );
      request.log.info(
        { exercise_id: updated.id, owner_user_id: actingUserId, modality_changed: modalityChanged },
        "custom_exercise_updated",
      );
      return toExerciseDto(updated);
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
      config: {
        published: true,
        problems: [NotFoundError, ExerciseAlreadyOwnedError, ExerciseRetiredError, CustomExerciseLimitError, ExerciseTypeLockedError],
        writeGroup: "exercises",
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      // Spec 03.4 AC20: a refused fork names the origin.
      const forked = await logTypeRefusal(request, request.params.id, () =>
        deps.exerciseRepository.forkExercise(actingUserId, request.params.id, request.body ?? {}),
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
      return toExerciseDto(forked);
    },
  );

  r.delete(
    "/exercises/:id",
    {
      schema: { params: exerciseIdParams, response: { 204: z.undefined() } },
      config: { published: true, problems: [ExerciseImmutableError, NotFoundError], writeGroup: "exercises" },
    },
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
