import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateWorkoutSectionSchema,
  SectionRoundParamsSchema,
  SetRoundTimeSchema,
  SetSectionResultSchema,
  UpdateWorkoutSectionSchema,
  WorkoutSectionSchema,
} from "@sin/core";
import { NotFoundError, SectionResultExistsError, SectionTimerMismatchError, WorkoutSectionLimitError } from "../errors/app-error.js";
import type { WorkoutRepository } from "../repositories/workout.js";
import { logFinishedEdit } from "./finished-edit-log.js";
import { toWorkoutSectionDto } from "./mappers.js";

/**
 * `routes/workout-sections.ts` — a workout's own sections (Spec 09.4 §5): created under the workout,
 * then addressed by the section id, live or finished. Ownership is resolved through the workout in
 * the repository (a malformed, missing or foreign id is 404). Log lines carry ids, counts and
 * booleans only — never a section name or note (§9, AC21).
 */
export interface WorkoutSectionRouteDeps {
  workoutRepository: WorkoutRepository;
}

export function registerWorkoutSectionRoutes(app: FastifyInstance, deps: WorkoutSectionRouteDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const idParams = z.object({ id: z.string() });

  r.post(
    "/workouts/:id/sections",
    {
      schema: { params: idParams, body: CreateWorkoutSectionSchema, response: { 201: WorkoutSectionSchema } },
      config: { published: true, problems: [NotFoundError, WorkoutSectionLimitError], writeGroup: "workouts" },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const notes = request.body.notes ?? null;
      const created = await deps.workoutRepository.addWorkoutSection(userId, request.params.id, {
        name: request.body.name,
        notes,
        timer: request.body.timer ?? null,
      });
      request.log.info(
        {
          workout_id: created.workoutId,
          section_id: created.id,
          user_id: userId,
          section_count: created.sectionCount,
          has_notes: notes !== null,
          timer_format: created.timer?.format ?? null,
        },
        "workout_section_added",
      );
      logFinishedEdit(request.log, userId, "section_added", created.finishedEdit);
      reply.code(201);
      return toWorkoutSectionDto(created);
    },
  );

  r.patch(
    "/workout-sections/:id",
    {
      schema: { params: idParams, body: UpdateWorkoutSectionSchema, response: { 200: WorkoutSectionSchema } },
      config: { published: true, problems: [NotFoundError, SectionResultExistsError], writeGroup: "workouts" },
    },
    async (request) => {
      const userId = request.user!.id;
      const updated = await deps.workoutRepository.updateWorkoutSection(userId, request.params.id, request.body);
      if (updated.timerChanged) {
        request.log.info(
          {
            workout_id: updated.workoutId,
            section_id: updated.id,
            user_id: userId,
            format: updated.timer?.format ?? null,
            cleared: updated.resultCleared,
          },
          "workout_section_timer_set",
        );
      }
      if (updated.nameChanged || updated.notesChanged) {
        request.log.info(
          {
            workout_id: updated.workoutId,
            section_id: updated.id,
            user_id: userId,
            name_changed: updated.nameChanged,
            notes_changed: updated.notesChanged,
          },
          "workout_section_updated",
        );
      }
      // One finished-edit line per request: a timer change outranks a name / note change (Spec 09.5 D21).
      logFinishedEdit(request.log, userId, updated.timerChanged ? "section_timer_changed" : "section_changed", updated.finishedEdit);
      return toWorkoutSectionDto(updated);
    },
  );

  r.delete(
    "/workout-sections/:id",
    {
      schema: { params: idParams, response: { 204: z.undefined() } },
      config: { published: true, problems: [NotFoundError], writeGroup: "workouts" },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const removed = await deps.workoutRepository.removeWorkoutSection(userId, request.params.id);
      request.log.info(
        { workout_id: removed.workoutId, section_id: request.params.id, user_id: userId, exercise_count: removed.exerciseCount },
        "workout_section_removed",
      );
      logFinishedEdit(request.log, userId, "section_removed", removed.finishedEdit);
      reply.code(204).send();
      return reply;
    },
  );

  // Spec 09.5 §6.2 — keyed, replay-safe round writes; the high-rate writes the outbox replays (`sets` group, D11).
  r.put(
    "/workout-sections/:id/round-times/:round",
    {
      schema: { params: SectionRoundParamsSchema, body: SetRoundTimeSchema, response: { 200: WorkoutSectionSchema } },
      config: { published: true, problems: [NotFoundError, SectionTimerMismatchError], writeGroup: "sets" },
    },
    async (request) => {
      const userId = request.user!.id;
      const { id, round } = request.params;
      const saved = await deps.workoutRepository.setSectionRoundTime(userId, id, round, request.body.seconds);
      request.log.info(
        { workout_id: saved.workoutId, section_id: saved.id, user_id: userId, round, changed: saved.changed },
        "workout_section_round_set",
      );
      logFinishedEdit(request.log, userId, "section_result_changed", saved.finishedEdit);
      return toWorkoutSectionDto(saved);
    },
  );

  r.delete(
    "/workout-sections/:id/round-times/:round",
    {
      schema: { params: SectionRoundParamsSchema, response: { 204: z.undefined() } },
      config: { published: true, problems: [NotFoundError], writeGroup: "sets" },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id, round } = request.params;
      const cleared = await deps.workoutRepository.clearSectionRoundTime(userId, id, round);
      request.log.info(
        { workout_id: cleared.workoutId, section_id: id, user_id: userId, round, removed: cleared.removed },
        "workout_section_round_cleared",
      );
      logFinishedEdit(request.log, userId, "section_result_changed", cleared.finishedEdit);
      reply.code(204).send();
      return reply;
    },
  );

  // Spec 09.5 §6.4 — the result is one whole value: PUT replaces it, DELETE clears it (round times stay).
  r.put(
    "/workout-sections/:id/result",
    {
      schema: { params: idParams, body: SetSectionResultSchema, response: { 200: WorkoutSectionSchema } },
      config: { published: true, problems: [NotFoundError, SectionTimerMismatchError], writeGroup: "sets" },
    },
    async (request) => {
      const userId = request.user!.id;
      const saved = await deps.workoutRepository.setSectionResult(userId, request.params.id, request.body);
      request.log.info(
        { workout_id: saved.workoutId, section_id: saved.id, user_id: userId, changed: saved.changed },
        "workout_section_result_set",
      );
      logFinishedEdit(request.log, userId, "section_result_changed", saved.finishedEdit);
      return toWorkoutSectionDto(saved);
    },
  );

  r.delete(
    "/workout-sections/:id/result",
    {
      schema: { params: idParams, response: { 204: z.undefined() } },
      config: { published: true, problems: [NotFoundError], writeGroup: "sets" },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const cleared = await deps.workoutRepository.clearSectionResult(userId, request.params.id);
      request.log.info(
        { workout_id: cleared.workoutId, section_id: request.params.id, user_id: userId, removed: cleared.removed },
        "workout_section_result_cleared",
      );
      logFinishedEdit(request.log, userId, "section_result_changed", cleared.finishedEdit);
      reply.code(204).send();
      return reply;
    },
  );
}
