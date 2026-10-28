import {
  HevyCreateTemplateReplySchema,
  HevyCreateWorkoutReplySchema,
  HevyFolderPageSchema,
  HevyRoutinePageSchema,
  HevyTemplatePageSchema,
  HevyUpdateWorkoutReplySchema,
  HevyUserInfoSchema,
  HevyWorkoutCountSchema,
  HevyWorkoutPageSchema,
  type HevyCreateTemplateBody,
  type HevyFolderPage,
  type HevyPostWorkout,
  type HevyRoutinePage,
  type HevyTemplatePage,
  type HevyUserInfo,
  type HevyWorkout,
  type HevyWorkoutPage,
} from "@sin/core";
import type { z } from "zod";
import { classifyHevyResponse, HevyError, parseRetryAfter, type HevyErrorKind } from "./hevyErrors";
import { HEVY_GET_RETRY_WAITS_MS, type Pacer } from "./pacer";

/**
 * Spec 20.0 AC7, AC8, AC11: the browser's client to Hevy's public API. This module is the only code that sends the
 * key, and only in the `api-key` header of a request to `HEVY_ORIGIN` (a source scan pins it). Every reply is parsed
 * with 19.0's schemas; every request waits on the shared pacer; a `GET` is retried on a 429, a 5xx or a network
 * failure, a write never (a retried `POST` could create a second Hevy workout). React-free.
 */

export const HEVY_ORIGIN = "https://api.hevyapp.com";

export type { HevyCreateTemplateBody };

export interface HevyClientDeps {
  fetch: typeof fetch;
  /** Read on every request, so a replaced key takes effect at once. */
  getKey: () => string | null;
  pacer: Pacer;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
}

export interface HevyClient {
  userInfo(signal?: AbortSignal): Promise<HevyUserInfo>;
  workoutCount(signal?: AbortSignal): Promise<number>;
  listTemplates(page: number, signal?: AbortSignal): Promise<HevyTemplatePage>;
  listWorkouts(page: number, signal?: AbortSignal): Promise<HevyWorkoutPage>;
  listRoutines(page: number, signal?: AbortSignal): Promise<HevyRoutinePage>;
  listFolders(page: number, signal?: AbortSignal): Promise<HevyFolderPage>;
  createWorkout(body: HevyPostWorkout, signal?: AbortSignal): Promise<HevyWorkout>;
  updateWorkout(id: string, body: HevyPostWorkout, signal?: AbortSignal): Promise<HevyWorkout>;
  createTemplate(body: HevyCreateTemplateBody, signal?: AbortSignal): Promise<{ id: string }>;
}

/** The kinds a `GET` is retried on (AC11). */
const RETRYABLE: ReadonlySet<HevyErrorKind> = new Set(["rate_limited", "server", "network"]);

const TEMPLATE_PAGE_SIZE = 100;
const PAGE_SIZE = 10;

export function createHevyClient(deps: HevyClientDeps): HevyClient {
  async function send<S extends z.ZodType>(
    method: "GET" | "POST" | "PUT",
    path: string,
    schema: S,
    opts: { body?: unknown; signal?: AbortSignal } = {},
  ): Promise<z.output<S>> {
    const retry = method === "GET";
    for (let attempt = 0; ; attempt++) {
      const key = deps.getKey();
      if (key === null) throw new HevyError("bad_key");
      await deps.pacer.wait(opts.signal);

      let failure: HevyError;
      let response: Response | null = null;
      try {
        const headers: Record<string, string> = { "api-key": key, Accept: "application/json" };
        if (opts.body !== undefined) headers["Content-Type"] = "application/json";
        response = await deps.fetch(`${HEVY_ORIGIN}${path}`, {
          method,
          headers,
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
          credentials: "omit",
          referrerPolicy: "no-referrer",
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
      } catch {
        if (opts.signal?.aborted) throw new HevyError("aborted");
        response = null;
      }

      if (response === null) {
        failure = new HevyError("network");
      } else if (response.ok) {
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new HevyError("unexpected_reply", { status: response.status });
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) throw new HevyError("unexpected_reply", { status: response.status });
        return parsed.data as z.output<S>;
      } else {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        failure = new HevyError(classifyHevyResponse(response.status, body), {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after"), deps.now()),
        });
      }

      // AC10: a Retry-After holds back every next request, whether or not this one is retried.
      if (failure.retryAfterMs !== null) deps.pacer.deferUntil(deps.now() + failure.retryAfterMs);
      if (!retry || !RETRYABLE.has(failure.kind) || attempt >= HEVY_GET_RETRY_WAITS_MS.length) throw failure;
      try {
        await deps.sleep(Math.max(HEVY_GET_RETRY_WAITS_MS[attempt]!, failure.retryAfterMs ?? 0), opts.signal);
      } catch {
        throw new HevyError("aborted");
      }
      if (opts.signal?.aborted) throw new HevyError("aborted");
    }
  }

  const page = (path: string, n: number, size: number) => `${path}?page=${n}&pageSize=${size}`;

  return {
    userInfo: (signal) => send("GET", "/v1/user/info", HevyUserInfoSchema, { signal }),
    workoutCount: async (signal) => (await send("GET", "/v1/workouts/count", HevyWorkoutCountSchema, { signal })).workout_count,
    listTemplates: (n, signal) => send("GET", page("/v1/exercise_templates", n, TEMPLATE_PAGE_SIZE), HevyTemplatePageSchema, { signal }),
    listWorkouts: (n, signal) => send("GET", page("/v1/workouts", n, PAGE_SIZE), HevyWorkoutPageSchema, { signal }),
    listRoutines: (n, signal) => send("GET", page("/v1/routines", n, PAGE_SIZE), HevyRoutinePageSchema, { signal }),
    listFolders: (n, signal) => send("GET", page("/v1/routine_folders", n, PAGE_SIZE), HevyFolderPageSchema, { signal }),
    createWorkout: async (body, signal) => (await send("POST", "/v1/workouts", HevyCreateWorkoutReplySchema, { body, signal })).workout[0],
    updateWorkout: (id, body, signal) =>
      send("PUT", `/v1/workouts/${encodeURIComponent(id)}`, HevyUpdateWorkoutReplySchema, { body, signal }),
    createTemplate: (body, signal) => send("POST", "/v1/exercise_templates", HevyCreateTemplateReplySchema, { body, signal }),
  };
}
