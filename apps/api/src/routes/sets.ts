import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateSetSchema, SetEntrySchema, UpdateSetSchema, type SetEntry } from "@sin/core";
import { NotFoundError, WorkoutFinishedError } from "../errors/app-error.js";
import type { SetEntryRecord, WorkoutRepository } from "../repositories/workout.js";

/**
 * `routes/sets.ts` — the three set-logging endpoints (Spec 05.1 §5, §6). Auth
 * comes from the /v1 scope; repository-thrown AppErrors map to problem+json
 * via the error contract, so there is no per-route try/catch (same as
 * `routes/workouts.ts`).
 */

export interface SetRouteDeps {
  workoutRepository: WorkoutRepository;
}

/** DB record -> wire DTO, keys in `SetEntrySchema` field order. */
export function toSetEntryDto(r: SetEntryRecord): SetEntry {
  return {
    id: r.id as SetEntry["id"],
    workoutExerciseId: r.workoutExerciseId as SetEntry["workoutExerciseId"],
    clientGeneratedId: r.clientGeneratedId,
    setNumber: r.setNumber,
    setType: r.setType as SetEntry["setType"],
    reps: r.reps,
    weight: r.weight,
    weightUnit: r.weightUnit as SetEntry["weightUnit"],
    weightKg: r.weightKg,
    distance: r.distance,
    distanceUnit: r.distanceUnit as SetEntry["distanceUnit"],
    distanceM: r.distanceM,
    durationS: r.durationS,
    rpe: r.rpe,
    isComplete: r.isComplete,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function registerSetRoutes(app: FastifyInstance, deps: SetRouteDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // `{id}` is a WorkoutExerciseId on create and a SetEntryId on patch/delete;
  // both are plain strings here, and the repository's branded guard turns a
  // malformed one into 404, never 422 (§5 "Path ids").
  const idParams = z.object({ id: z.string() });

  // `created: false` is an idempotent replay of a `clientGeneratedId` (§6.2,
  // D15): 200, no Location, no `set_created` — same as POST /v1/workouts.
  r.post(
    "/workout-exercises/:id/sets",
    {
      schema: {
        params: idParams,
        body: CreateSetSchema,
        response: { 201: SetEntrySchema, 200: SetEntrySchema },
      },
      config: { published: true, problems: [NotFoundError, WorkoutFinishedError], writeGroup: "sets" },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const { set, modalitySnapshot, created } = await deps.workoutRepository.createSet(
        actingUserId,
        request.params.id,
        request.body,
      );
      if (!created) {
        reply.code(200);
        return toSetEntryDto(set);
      }
      // §6.6: ids and enums only, never a measure value.
      request.log.info(
        {
          set_id: set.id,
          workout_exercise_id: set.workoutExerciseId,
          user_id: actingUserId,
          set_type: set.setType,
          modality_snapshot: modalitySnapshot,
        },
        "set_created",
      );
      reply.code(201).header("location", `/v1/sets/${set.id}`);
      return toSetEntryDto(set);
    },
  );

  r.patch(
    "/sets/:id",
    {
      schema: { params: idParams, body: UpdateSetSchema, response: { 200: SetEntrySchema } },
      config: { published: true, problems: [NotFoundError, WorkoutFinishedError], writeGroup: "sets" },
    },
    async (request) => {
      const updated = await deps.workoutRepository.updateSet(request.user!.id, request.params.id, request.body);
      return toSetEntryDto(updated);
    },
  );

  r.delete(
    "/sets/:id",
    {
      schema: { params: idParams, response: { 204: z.undefined() } },
      config: { published: true, problems: [NotFoundError, WorkoutFinishedError], writeGroup: "sets" },
    },
    async (request, reply) => {
      await deps.workoutRepository.deleteSet(request.user!.id, request.params.id);
      reply.code(204).send();
      return reply;
    },
  );
}
