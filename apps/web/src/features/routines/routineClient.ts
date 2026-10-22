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
  /** Spec 10.5: `oneOff` is added here, never by `toRoutineInput` (shared with the `PUT`, which rejects it). */
  create(body: RoutineWriteInput, options?: { oneOff?: true }): Promise<Routine>;
  replace(id: string, body: RoutineWriteInput): Promise<Routine>;
  remove(id: string): Promise<void>;
  /** Spec 09.3 Keep: no body, so the API client sends no Content-Type; `204`. */
  keep(id: string): Promise<void>;
}

/** Every id is one encoded path segment: `a/b?c#d` cannot change the endpoint. */
const seg = encodeURIComponent;

export function createRoutineClient(api: Pick<ApiClient, "get" | "post" | "request" | "delete">): RoutineClient {
  return {
    list: async () => (await api.get("/v1/routines", RoutineListResponseSchema)).routines,
    get: (id) => api.get(`/v1/routines/${seg(id)}`, RoutineSchema),
    create: (body, options) => api.post("/v1/routines", options?.oneOff ? { ...body, oneOff: true } : body, RoutineSchema),
    // `ApiClient` has no `put` helper; `request` takes the method.
    replace: (id, body) => api.request<Routine>(`/v1/routines/${seg(id)}`, { method: "PUT", body, schema: RoutineSchema }),
    remove: async (id) => {
      await api.delete(`/v1/routines/${seg(id)}`);
    },
    keep: async (id) => {
      await api.request(`/v1/routines/${seg(id)}/keep`, { method: "POST" });
    },
  };
}
