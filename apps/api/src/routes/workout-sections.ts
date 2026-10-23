import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateWorkoutSectionSchema, UpdateWorkoutSectionSchema, WorkoutSectionSchema } from "@sin/core";
import { NotFoundError, WorkoutSectionLimitError } from "../errors/app-error.js";
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
      const created = await deps.workoutRepository.addWorkoutSection(userId, request.params.id, { name: request.body.name, notes });
      request.log.info(
        {
          workout_id: created.workoutId,
          section_id: created.id,
          user_id: userId,
          section_count: created.sectionCount,
          has_notes: notes !== null,
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
      config: { published: true, problems: [NotFoundError], writeGroup: "workouts" },
    },
    async (request) => {
      const userId = request.user!.id;
      const updated = await deps.workoutRepository.updateWorkoutSection(userId, request.params.id, request.body);
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
      logFinishedEdit(request.log, userId, "section_changed", updated.finishedEdit);
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
}
