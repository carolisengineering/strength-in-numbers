import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AddWorkoutExerciseSchema,
  CreateWorkoutSchema,
  UpdateWorkoutExerciseSchema,
  UpdateWorkoutSchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  type Workout,
  type WorkoutDetail,
  type WorkoutExercise,
} from "@sin/core";
import { assertStartedAtInBounds } from "../repositories/workout-writes.js";
import type {
  WorkoutDetailRecord,
  WorkoutExerciseRecord,
  WorkoutRecord,
  WorkoutRepository,
} from "../repositories/workout.js";

/**
 * `routes/workouts.ts` — the eight workout-lifecycle endpoints (Spec 05.0 §5,
 * §6). Every route requires the `/v1` auth plugin (registered on the parent
 * scope, not per-route here — see `app.ts`'s `/v1` registration block) and
 * every repository-thrown `AppError` subclass propagates to the RFC 9457
 * problem+json contract via Fastify's error handler (`errors/contract.ts`);
 * no per-route try/catch is needed.
 */

export interface WorkoutRouteDeps {
  workoutRepository: WorkoutRepository;
}

/** DB record -> wire DTO, keys in `WorkoutSchema` field order (§5). */
function toWorkoutDto(r: WorkoutRecord): Workout {
  return {
    id: r.id as Workout["id"],
    title: r.title,
    notes: r.notes,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    localDate: r.localDate,
    tzOffsetMinutes: r.tzOffsetMinutes,
    clientGeneratedId: r.clientGeneratedId,
    source: r.source as Workout["source"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toWorkoutExerciseDto(r: WorkoutExerciseRecord): WorkoutExercise {
  return {
    id: r.id as WorkoutExercise["id"],
    workoutId: r.workoutId as WorkoutExercise["workoutId"],
    position: r.position,
    exerciseId: r.exerciseId as WorkoutExercise["exerciseId"],
    exerciseNameSnapshot: r.exerciseNameSnapshot,
    modalitySnapshot: r.modalitySnapshot as WorkoutExercise["modalitySnapshot"],
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toWorkoutDetailDto(r: WorkoutDetailRecord): WorkoutDetail {
  return { ...toWorkoutDto(r), exercises: r.exercises.map(toWorkoutExerciseDto) };
}

export function registerWorkoutRoutes(app: FastifyInstance, deps: WorkoutRouteDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const workoutIdParams = z.object({ id: z.string() });
  const workoutExerciseIdParams = z.object({ id: z.string() });

  // POST /v1/workouts — idempotent create (§6.1). `created: true` -> 201 +
  // Location; `created: false` (a replay) -> 200, no Location, stored row
  // (the replayed body is ignored, D39). `assertStartedAtInBounds` runs HERE,
  // not in the repository (Task 10 left the skew check out of `createWorkout`
  // deliberately) — validation is a property of the request, evaluated once
  // per call regardless of whether it turns out to be a fresh create or a
  // replay.
  r.post(
    "/workouts",
    { schema: { body: CreateWorkoutSchema, response: { 201: WorkoutSchema, 200: WorkoutSchema } } },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const startedAt = new Date(request.body.startedAt);
      assertStartedAtInBounds(startedAt, new Date());

      const { workout, created } = await deps.workoutRepository.createWorkout(
        actingUserId,
        {
          clientGeneratedId: request.body.clientGeneratedId,
          startedAt,
          tzOffsetMinutes: request.body.tzOffsetMinutes,
          title: request.body.title,
          notes: request.body.notes,
        },
        request.user!.timezone,
      );

      if (created) {
        request.log.info({ workout_id: workout.id, user_id: actingUserId }, "workout_started");
        reply.code(201).header("location", `/v1/workouts/${workout.id}`);
      } else {
        reply.code(200);
      }
      return toWorkoutDto(workout);
    },
  );

  r.get("/workouts/active", { schema: { response: { 200: WorkoutDetailSchema } } }, async (request) => {
    const detail = await deps.workoutRepository.getActiveWorkout(request.user!.id);
    return toWorkoutDetailDto(detail);
  });

  r.get(
    "/workouts/:id",
    { schema: { params: workoutIdParams, response: { 200: WorkoutDetailSchema } } },
    async (request) => {
      const detail = await deps.workoutRepository.getWorkoutById(request.user!.id, request.params.id);
      return toWorkoutDetailDto(detail);
    },
  );

  r.patch(
    "/workouts/:id",
    { schema: { params: workoutIdParams, body: UpdateWorkoutSchema, response: { 200: WorkoutSchema } } },
    async (request) => {
      const actingUserId = request.user!.id;
      const isFinishAttempt = request.body.endedAt !== undefined && request.body.endedAt !== null;
      const { workout: updated, exerciseCount } = await deps.workoutRepository.updateWorkout(
        actingUserId,
        request.params.id,
        request.body,
      );
      if (isFinishAttempt && updated.endedAt !== null) {
        const durationSeconds = Math.round((updated.endedAt.getTime() - updated.startedAt.getTime()) / 1000);
        request.log.info(
          {
            workout_id: updated.id,
            user_id: actingUserId,
            duration_seconds: durationSeconds,
            exercise_count: exerciseCount,
          },
          "workout_finished",
        );
      }
      return toWorkoutDto(updated);
    },
  );

  r.delete(
    "/workouts/:id",
    { schema: { params: workoutIdParams, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const { wasFinished, exerciseCount } = await deps.workoutRepository.deleteWorkout(
        actingUserId,
        request.params.id,
      );
      request.log.info(
        {
          workout_id: request.params.id,
          user_id: actingUserId,
          was_finished: wasFinished,
          exercise_count: exerciseCount,
        },
        "workout_deleted",
      );
      reply.code(204).send();
      return reply;
    },
  );

  r.post(
    "/workouts/:id/exercises",
    {
      schema: {
        params: workoutIdParams,
        body: AddWorkoutExerciseSchema,
        response: { 201: WorkoutExerciseSchema },
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const created = await deps.workoutRepository.addWorkoutExercise(actingUserId, request.params.id, request.body);
      request.log.info(
        {
          workout_id: request.params.id,
          workout_exercise_id: created.id,
          exercise_id: created.exerciseId,
          user_id: actingUserId,
          position: created.position,
        },
        "workout_exercise_added",
      );
      reply.code(201).header("location", `/v1/workout-exercises/${created.id}`);
      return toWorkoutExerciseDto(created);
    },
  );

  r.patch(
    "/workout-exercises/:id",
    {
      schema: {
        params: workoutExerciseIdParams,
        body: UpdateWorkoutExerciseSchema,
        response: { 200: WorkoutExerciseSchema },
      },
    },
    async (request) => {
      const updated = await deps.workoutRepository.updateWorkoutExercise(
        request.user!.id,
        request.params.id,
        request.body,
      );
      return toWorkoutExerciseDto(updated);
    },
  );

  r.delete(
    "/workout-exercises/:id",
    { schema: { params: workoutExerciseIdParams, response: { 204: z.undefined() } } },
    async (request, reply) => {
      await deps.workoutRepository.deleteWorkoutExercise(request.user!.id, request.params.id);
      reply.code(204).send();
      return reply;
    },
  );
}
