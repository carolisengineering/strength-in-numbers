import { RoutineListResponseSchema, RoutineSchema, type Routine } from "@sin/core";
import type { ApiClient } from "../../api";
import type { RoutineWriteInput } from "./validateDraft";

/**
 * The REST seam for routines (Spec 10.0 AC10), React-free, shaped like `workoutClient`. No ETag code:
 * the API answers `private, no-cache` + `ETag` and the browser's HTTP cache revalidates (Spec 09 AC4).
 */
export interface RoutineClient {
  list(): Promise<Routine[]>;
  get(id: string): Promise<Routine>;
  create(body: RoutineWriteInput): Promise<Routine>;
  replace(id: string, body: RoutineWriteInput): Promise<Routine>;
  remove(id: string): Promise<void>;
}

/** Every id is one encoded path segment: `a/b?c#d` cannot change the endpoint. */
const seg = encodeURIComponent;

export function createRoutineClient(api: Pick<ApiClient, "get" | "post" | "request" | "delete">): RoutineClient {
  return {
    list: async () => (await api.get("/v1/routines", RoutineListResponseSchema)).routines,
    get: (id) => api.get(`/v1/routines/${seg(id)}`, RoutineSchema),
    create: (body) => api.post("/v1/routines", body, RoutineSchema),
    // `ApiClient` has no `put` helper; `request` takes the method.
    replace: (id, body) => api.request<Routine>(`/v1/routines/${seg(id)}`, { method: "PUT", body, schema: RoutineSchema }),
    remove: async (id) => {
      await api.delete(`/v1/routines/${seg(id)}`);
    },
  };
}
