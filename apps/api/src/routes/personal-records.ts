import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { PersonalRecordsQuerySchema, PersonalRecordsResponseSchema, type PersonalRecord } from "@sin/core";
import type { PersonalRecordRecord, PersonalRecordRepository } from "../repositories/personal-record.js";

/**
 * `routes/personal-records.ts` — `GET /v1/personal-records` (Spec 07.0 §5).
 * Un-paginated by design (≤ 4 rows per lineage root — a documented exception
 * to DESIGN §6's cursor rule), default `no-store` cache policy, no writeGroup
 * (a GET). Unknown / foreign ids return an empty list, never 404 (§7).
 */

export interface PersonalRecordRouteDeps {
  personalRecordRepository: PersonalRecordRepository;
}

/** Repository record -> wire DTO, keys in `PersonalRecordSchema` field order. */
export function toPersonalRecordDto(r: PersonalRecordRecord): PersonalRecord {
  return {
    exerciseId: r.exerciseId as PersonalRecord["exerciseId"],
    sourceExerciseId: r.sourceExerciseId as PersonalRecord["sourceExerciseId"],
    exerciseName: r.exerciseName,
    recordType: r.recordType,
    value: r.value,
    unit: r.unit,
    previousValue: r.previousValue,
    sourceSetId: r.sourceSetId as PersonalRecord["sourceSetId"],
    workoutId: r.workoutId as PersonalRecord["workoutId"],
    achievedAt: r.achievedAt.toISOString(),
    localDate: r.localDate,
  };
}

export function registerPersonalRecordRoutes(app: FastifyInstance, deps: PersonalRecordRouteDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/personal-records",
    {
      schema: { querystring: PersonalRecordsQuerySchema, response: { 200: PersonalRecordsResponseSchema } },
      config: { published: true, problems: [] },
    },
    async (request) => {
      const records = await deps.personalRecordRepository.list(request.user!.id, {
        exerciseId: request.query.exerciseId,
        workoutId: request.query.workoutId,
      });
      return { records: records.map(toPersonalRecordDto) };
    },
  );
}
