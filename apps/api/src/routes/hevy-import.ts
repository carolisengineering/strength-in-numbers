import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { HevyImportBatchSchema, HevyImportFinishResponseSchema, HevyImportResponseSchema, type HevyImportOutcome } from "@sin/core";
import type { HevyImportRepository } from "../repositories/hevy-import.js";

/** Spec 19.1 §8: the batch route's request-body limit (beside 19.0's `HEVY_MAPPING_BODY_LIMIT`, minor 160). */
export const HEVY_IMPORT_BODY_LIMIT = 512 * 1024;

export interface HevyImportRouteDeps {
  hevyImportRepository: HevyImportRepository;
}

/**
 * Spec 19.1 §5: the bulk import. Registered inside 19.0's gated Hevy scope (`registerHevyRoutes`), so anyone not on
 * `HEVY_ENABLED_USER_IDS` gets the unknown-route `404` before the body limit, the write group or validation. Not
 * published. Logs carry `user_id` and counts only — never a Hevy title, note or id (AC32, AC35).
 */
export function registerHevyImportRoutes(scope: FastifyInstance, deps: HevyImportRouteDeps): void {
  const r = scope.withTypeProvider<ZodTypeProvider>();
  const repo = deps.hevyImportRepository;

  r.post(
    "/hevy/import/workouts",
    {
      bodyLimit: HEVY_IMPORT_BODY_LIMIT,
      schema: { body: HevyImportBatchSchema, response: { 200: HevyImportResponseSchema } },
      config: { writeGroup: "hevy" },
    },
    async (request) => {
      const started = Date.now();
      const userId = request.user!.id;
      const batch = await repo.importBatch(userId, request.body, new Date());
      const outcomes: Partial<Record<HevyImportOutcome, number>> = {};
      for (const r of batch.results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
      request.log.info(
        {
          user_id: userId,
          dry_run: request.body.dryRun,
          workouts: batch.results.length,
          outcomes,
          sets_created: batch.setsCreated,
          sets_dropped: batch.setsDropped,
          ms: Date.now() - started,
        },
        "hevy_import_batch",
      );
      return { dryRun: request.body.dryRun, results: batch.results };
    },
  );

  r.post(
    "/hevy/import/finish",
    {
      schema: { response: { 200: HevyImportFinishResponseSchema } },
      config: { writeGroup: "hevy" },
    },
    async (request) => {
      const started = Date.now();
      const userId = request.user!.id;
      const done = await repo.finishImport(userId);
      request.log.info(
        { user_id: userId, recomputed: done.recomputed, root_count: done.rootCount, ms: Date.now() - started },
        "hevy_import_finished",
      );
      return done;
    },
  );
}
