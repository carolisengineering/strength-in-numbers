import { WorkoutHistoryResponseSchema, type WorkoutHistoryResponse } from "@sin/core";
import type { ApiClient } from "../../api";

/** 07.1's default page size, sent explicitly so the client's paging does not depend on a server default. */
export const HISTORY_PAGE_SIZE = 20;

/**
 * `GET /v1/workouts` (Spec 07.1), React-free. The cursor is opaque (07.1 §6.2 rule 3): passed
 * through verbatim, never decoded or built here (Spec 08.0 AC3).
 */
export interface HistoryClient {
  listWorkouts(params: { cursor?: string }): Promise<WorkoutHistoryResponse>;
}

export function createHistoryClient(api: Pick<ApiClient, "get">): HistoryClient {
  return {
    listWorkouts: ({ cursor }) => {
      const query = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
      if (cursor !== undefined) query.set("cursor", cursor);
      return api.get(`/v1/workouts?${query.toString()}`, WorkoutHistoryResponseSchema);
    },
  };
}
