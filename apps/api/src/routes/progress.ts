import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  ExerciseIdSchema,
  ProgressQuerySchema,
  ProgressSeriesSchema,
  milliToDecimalString,
  type ProgressPoint,
  type ProgressSeries,
} from "@sin/core";
import { NotFoundError } from "../errors/app-error.js";
import type { PersonalRecordRepository, ProgressPointRecord } from "../repositories/personal-record.js";

/**
 * `routes/progress.ts` — `GET /v1/progress/exercises/{id}` (Spec 07.2 §5).
 * One point per finished workout of the exercise's fork lineage, oldest
 * first; un-paginated (bounded by training frequency — a documented
 * exception to DESIGN §6's cursor rule, D6). Default no-store; a GET, so no
 * writeGroup. An unseen exercise is 404 (a path resource, D3).
 */

const ProgressParams = z.object({ id: ExerciseIdSchema });

const decimal = (milli: number | null): number | null => (milli === null ? null : Number(milliToDecimalString(milli)));

/** Repository milli → wire DTO, no division (07.0 D14 / 07.1 D5). */
export function toProgressPointDto(r: ProgressPointRecord): ProgressPoint {
  return {
    workoutId: r.workoutId as ProgressPoint["workoutId"],
    localDate: r.localDate,
    startedAt: r.startedAt.toISOString(),
    topSetWeight: decimal(r.topSetWeightMilli),
    bestE1rm: decimal(r.bestE1rmMilli),
    totalVolume: decimal(r.totalVolumeMilli),
    maxReps: decimal(r.maxRepsMilli), // reps × 1000 → an integer count
  };
}

export function registerProgressRoutes(
  app: FastifyInstance,
  deps: { personalRecordRepository: PersonalRecordRepository },
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/progress/exercises/:id",
    {
      schema: { params: ProgressParams, querystring: ProgressQuerySchema, response: { 200: ProgressSeriesSchema } },
      config: { published: true, problems: [NotFoundError] },
    },
    async (request) => {
      const series = await deps.personalRecordRepository.getProgressSeries(request.user!.id, request.params.id, {
        from: request.query.from,
        to: request.query.to,
      });
      return {
        exerciseId: series.exerciseId as ProgressSeries["exerciseId"],
        points: series.points.map(toProgressPointDto),
      };
    },
  );
}
