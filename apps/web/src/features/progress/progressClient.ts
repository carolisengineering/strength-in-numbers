import { ProgressSeriesSchema, type ProgressSeries } from "@sin/core";
import type { ApiClient } from "../../api";

/** `GET /v1/progress/exercises/{id}` (Spec 07.2), React-free. Knows nothing about ranges or clocks (AC5). */
export interface ProgressClient {
  getSeries(exerciseId: string, params: { from?: string }): Promise<ProgressSeries>;
}

export function createProgressClient(api: Pick<ApiClient, "get">): ProgressClient {
  return {
    getSeries: (exerciseId, { from }) => {
      const query = new URLSearchParams();
      if (from !== undefined) query.set("from", from);
      const qs = query.toString();
      return api.get(`/v1/progress/exercises/${encodeURIComponent(exerciseId)}${qs === "" ? "" : `?${qs}`}`, ProgressSeriesSchema);
    },
  };
}
