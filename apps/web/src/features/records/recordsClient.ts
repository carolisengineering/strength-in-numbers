import { PersonalRecordsResponseSchema, type PersonalRecord } from "@sin/core";
import type { ApiClient } from "../../api";

/** `GET /v1/personal-records` (Spec 07.0 §5), React-free. `exerciseId` is for Spec 08.1. */
export interface RecordsClient {
  listRecords(filter: { workoutId?: string; exerciseId?: string }): Promise<PersonalRecord[]>;
}

export function createRecordsClient(api: Pick<ApiClient, "get">): RecordsClient {
  return {
    async listRecords({ workoutId, exerciseId }) {
      const query = new URLSearchParams();
      if (workoutId !== undefined) query.set("workoutId", workoutId);
      if (exerciseId !== undefined) query.set("exerciseId", exerciseId);
      const qs = query.toString();
      const body = await api.get(`/v1/personal-records${qs === "" ? "" : `?${qs}`}`, PersonalRecordsResponseSchema);
      return body.records;
    },
  };
}
