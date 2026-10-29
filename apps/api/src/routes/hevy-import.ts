import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { HevyImportBatchSchema, HevyImportFinishResponseSchema, HevyImportResponseSchema } from "@sin/core";
import { emptyHevyImportTally, type HevyImportRepository } from "../repositories/hevy-import.js";

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
      // Filled as each workout is answered, and logged from `finally`, so a 500 partway still traces what the
      // workouts before it did (minor 158).
      const tally = emptyHevyImportTally();
      let partial = true;
      try {
        const batch = await repo.importBatch(userId, request.body, new Date(), tally);
        partial = false;
        return { dryRun: request.body.dryRun, results: batch.results };
      } finally {
        request.log.info(
          {
            user_id: userId,
            dry_run: request.body.dryRun,
            workouts: tally.results,
            outcomes: tally.outcomes,
            sets_created: tally.setsCreated,
            sets_dropped: tally.setsDropped,
            partial,
            ms: Date.now() - started,
          },
          "hevy_import_batch",
        );
      }
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
