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
  WorkoutHistoryQuerySchema,
  WorkoutHistoryResponseSchema,
  milliToDecimalString,
  tenthsToRpe,
  type WorkoutSummary,
  UpdatedWorkoutSchema,
  type UpdatedWorkout,
  type Workout,
  type WorkoutDetail,
  type WorkoutExercise,
  type WorkoutExerciseDetail,
} from "@sin/core";
import {
  ExerciseRetiredError,
  IncompleteWorkingSetsError,
  NotFoundError,
  WorkoutFinishedError,
  WorkoutInProgressExistsError,
} from "../errors/app-error.js";
import { toSetEntryDto } from "./sets.js";
import { toPersonalRecordDto } from "./personal-records.js";
import { assertStartedAtInBounds } from "../repositories/workout-writes.js";
import type {
  WorkoutDetailRecord,
  WorkoutExerciseRecord,
  WorkoutRecord,
  WorkoutRepository,
  WorkoutSummaryRecord,
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
    routineName: r.routineName,
  };
}

/** History row -> wire DTO (Spec 07.1 §5). Volume via the decimal string, no
 * division (D5). */
function toWorkoutSummaryDto(r: WorkoutSummaryRecord): WorkoutSummary {
  return {
    ...toWorkoutDto(r),
    exerciseCount: r.exerciseCount,
    exerciseNames: r.exerciseNames,
    workingSetCount: r.workingSetCount,
    totalVolume: r.totalVolumeMilli === null ? null : Number(milliToDecimalString(r.totalVolumeMilli)),
    recordCount: r.recordCount,
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
    targetSets: r.targetSets,
    targetRepsLow: r.targetRepsLow,
    targetRepsHigh: r.targetRepsHigh,
    // Spec 09 D5: the one tenths → decimal conversion on the read side.
    targetRpe: r.targetRpeTenths === null ? null : tenthsToRpe(r.targetRpeTenths),
    restSeconds: r.restSeconds,
    supersetGroup: r.supersetGroup,
  };
}

function toWorkoutDetailDto(r: WorkoutDetailRecord): WorkoutDetail {
  return {
    ...toWorkoutDto(r),
    exercises: r.exercises.map(
      (e): WorkoutExerciseDetail => ({ ...toWorkoutExerciseDto(e), sets: e.sets.map(toSetEntryDto) }),
    ),
  };
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
    {
      schema: { body: CreateWorkoutSchema, response: { 201: WorkoutSchema, 200: WorkoutSchema } },
      config: {
        published: true,
        problems: [WorkoutInProgressExistsError, NotFoundError, ExerciseRetiredError],
        writeGroup: "workouts",
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const startedAt = new Date(request.body.startedAt);
      assertStartedAtInBounds(startedAt, new Date());

      const { workout, created, copiedCount } = await deps.workoutRepository.createWorkout(
        actingUserId,
        {
          clientGeneratedId: request.body.clientGeneratedId,
          startedAt,
          tzOffsetMinutes: request.body.tzOffsetMinutes,
          title: request.body.title,
          notes: request.body.notes,
          routineId: request.body.routineId,
        },
        request.user!.timezone,
      );

      if (created) {
        request.log.info({ workout_id: workout.id, user_id: actingUserId }, "workout_started");
        if (request.body.routineId !== undefined) {
          // Spec 09 §9: ids and counts only.
          request.log.info(
            { workout_id: workout.id, routine_id: request.body.routineId, user_id: actingUserId, item_count: copiedCount },
            "workout_started_from_routine",
          );
        }
        reply.code(201).header("location", `/v1/workouts/${workout.id}`);
      } else {
        reply.code(200);
      }
      return toWorkoutDto(workout);
    },
  );

  // Spec 07.1 — the history list. Newest finished first, keyset-paged by an
  // opaque cursor (§6.2). Default no-store (D14); a GET, so no writeGroup.
  r.get(
    "/workouts",
    {
      schema: { querystring: WorkoutHistoryQuerySchema, response: { 200: WorkoutHistoryResponseSchema } },
      config: { published: true, problems: [] },
    },
    async (request) => {
      const page = await deps.workoutRepository.listFinishedWorkouts(request.user!.id, {
        limit: request.query.limit,
        cursor: request.query.cursor,
      });
      return { items: page.items.map(toWorkoutSummaryDto), next: page.next };
    },
  );

  r.get(
    "/workouts/active",
    { schema: { response: { 200: WorkoutDetailSchema } }, config: { published: true, problems: [NotFoundError] } },
    async (request) => {
      const detail = await deps.workoutRepository.getActiveWorkout(request.user!.id);
      return toWorkoutDetailDto(detail);
    },
  );

  r.get(
    "/workouts/:id",
    { schema: { params: workoutIdParams, response: { 200: WorkoutDetailSchema } }, config: { published: true, problems: [NotFoundError] } },
    async (request) => {
      const detail = await deps.workoutRepository.getWorkoutById(request.user!.id, request.params.id);
      return toWorkoutDetailDto(detail);
    },
  );

  r.patch(
    "/workouts/:id",
    {
      schema: { params: workoutIdParams, body: UpdateWorkoutSchema, response: { 200: UpdatedWorkoutSchema } },
      config: { published: true, problems: [NotFoundError, WorkoutFinishedError, IncompleteWorkingSetsError], writeGroup: "workouts" },
    },
    async (request) => {
      const actingUserId = request.user!.id;
      const isFinishAttempt = request.body.endedAt !== undefined && request.body.endedAt !== null;
      const { workout: updated, exerciseCount, newRecords } = await deps.workoutRepository.updateWorkout(
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
            record_count: newRecords.length,
          },
          "workout_finished",
        );
      }
      // Spec 07.0 §5: the finish summary rides on the PATCH response.
      const body: UpdatedWorkout = { ...toWorkoutDto(updated), newRecords: newRecords.map(toPersonalRecordDto) };
      return body;
    },
  );

  r.delete(
    "/workouts/:id",
    {
      schema: { params: workoutIdParams, response: { 204: z.undefined() } },
      config: { published: true, problems: [NotFoundError], writeGroup: "workouts" },
    },
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
      config: { published: true, problems: [NotFoundError, WorkoutFinishedError, ExerciseRetiredError], writeGroup: "workouts" },
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
      config: { published: true, problems: [NotFoundError, WorkoutFinishedError], writeGroup: "workouts" },
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
    {
      schema: { params: workoutExerciseIdParams, response: { 204: z.undefined() } },
      config: { published: true, problems: [NotFoundError, WorkoutFinishedError], writeGroup: "workouts" },
    },
    async (request, reply) => {
      await deps.workoutRepository.deleteWorkoutExercise(request.user!.id, request.params.id);
      reply.code(204).send();
      return reply;
    },
  );
}
