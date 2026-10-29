import { createContext, useContext, useMemo } from "react";
import {
  HevyImportFinishResponseSchema,
  HevyImportResponseSchema,
  type HevyImportBatch,
  type HevyImportFinishResponse,
  type HevyImportResponse,
} from "@sin/core";

import type { ApiClient } from "../../../api/client";
import { useApi } from "../../../auth/useApi";

/**
 * Spec 20.1 AC11, AC22: the only module that names `/v1/hevy/import` (AC30). It parses every reply itself: in
 * production `ApiClient.request` logs a schema failure and passes the raw body through, and a reply the import
 * can't trust must stop it.
 */

export class ImportReplyError extends Error {
  readonly kind: "mismatch" | "schema";

  constructor(kind: "mismatch" | "schema") {
    super(`The import reply wasn't understood (${kind})`);
    this.name = "ImportReplyError";
    this.kind = kind;
  }
}

export interface HevyImportClient {
  importBatch(body: HevyImportBatch, signal?: AbortSignal): Promise<HevyImportResponse>;
  finish(signal?: AbortSignal): Promise<HevyImportFinishResponse>;
}

export function createHevyImportClient(api: Pick<ApiClient, "request">): HevyImportClient {
  return {
    importBatch: async (body, signal) => {
      const raw = await api.request("/v1/hevy/import/workouts", { method: "POST", body, ...(signal ? { signal } : {}) });
      const parsed = HevyImportResponseSchema.safeParse(raw);
      if (!parsed.success) throw new ImportReplyError("schema");
      if (parsed.data.results.length !== body.workouts.length) throw new ImportReplyError("mismatch");
      return parsed.data;
    },
    // §6.8 / 19.1 §5.2: no body, so no Content-Type (a JSON type with an empty body is Fastify's 400), as `RoutineClient.keep`.
    finish: async (signal) => {
      const raw = await api.request("/v1/hevy/import/finish", { method: "POST", ...(signal ? { signal } : {}) });
      const parsed = HevyImportFinishResponseSchema.safeParse(raw);
      if (!parsed.success) throw new ImportReplyError("schema");
      return parsed.data;
    },
  };
}

/** The seam tests inject a fake through (the `RoutineClientContext` pattern). */
export const HevyImportClientContext = createContext<HevyImportClient | null>(null);

/** The injected client, or one over the app's API client, so nothing outside `features/hevy/` mounts a provider. */
export function useHevyImportClient(): HevyImportClient {
  const injected = useContext(HevyImportClientContext);
  const api = useApi();
  return useMemo(() => injected ?? createHevyImportClient(api), [injected, api]);
}
