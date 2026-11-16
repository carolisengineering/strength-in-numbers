import {
  SetEntrySchema,
  UpdatedWorkoutSchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  WorkoutSectionSchema,
  type CreateSet,
  type CreateWorkout,
  type SetEntry,
  type UpdateSet,
  type UpdatedWorkout,
  type Workout,
  type WorkoutDetail,
  type WorkoutExercise,
  type WorkoutSection,
  type CreateWorkoutSection,
  type SetSectionResult,
  type UpdateWorkoutSection,
} from "@sin/core";
import { ApiError, type ApiClient, type ApiRequestOptions } from "../../api";
import type { ResponseSchema } from "../../api/client";
import type { FinishMeta } from "./outbox/ops";

/** The keys `updateWorkoutExercise` may send (Spec 10.1 AC11). Deliberately no `notes` (Spec 09 D22). */
export interface WorkoutExercisePatch {
  readonly position?: number;
  readonly supersetGroup?: number | null;
}

/** Spec 18.0 AC54: a finished workout's title and notes; AC29: Change Time's keys. */
export interface WorkoutUpdate {
  readonly title?: string | null;
  readonly notes?: string | null;
  readonly startedAt?: string;
  /** Only with `startedAt` (07.4). */
  readonly tzOffsetMinutes?: number;
  readonly durationSeconds?: number | null;
}

/** Spec 06.7 AC5: the outbox's deadline. With a signal, the call goes through `api.request`, which hands it to `fetch`. */
export interface SendOptions {
  readonly signal?: AbortSignal;
}

/**
 * Spec 06.7 AC13: what a Finish tap became. `landed`: the cloud has it (on the queued client, the landing effects have
 * run; the REST client runs none). `queued`: it is saved on this phone and sends later; `durable` is false when the
 * phone couldn't save it (keep the page open). `refused` (code review, B1): the finish op failed within the wait — the
 * server refused it, or an earlier write of the workout had failed — so the workout reopens to fix (AC29), never
 * "saved on this phone".
 */
export type FinishOutcome =
  | { status: "landed" }
  | { status: "queued"; reason: "offline" | "slow"; durable: boolean }
  | { status: "refused" };

/**
 * The REST seam for the workout screen (Spec 06.1 §6.1). React-free. Every write the screen makes
 * goes through this object so Spec 06.2 can replace it with a queue-backed one; the mutation hooks
 * never call `api.*` directly.
 */
export interface WorkoutClient {
  /** `null` when there is no in-progress workout (the API answers 404). */
  getActive(): Promise<WorkoutDetail | null>;
  getById(id: string, options?: SendOptions): Promise<WorkoutDetail>;
  start(body: CreateWorkout): Promise<Workout>;
  /** The workout plus `newRecords` (Spec 07.0 D12): parsed with `UpdatedWorkoutSchema` so Zod keeps it (Spec 08.0 AC5). */
  finish(id: string, body: { endedAt: string; keepRoutine?: true }, options?: SendOptions): Promise<UpdatedWorkout>;
  /**
   * Spec 06.7 AC13: finish, or queue the finish. Resolves; rejects only for a programming error (a network, timeout or
   * server failure is the op's, AC3). The REST client (the edit client, which never queues) wraps `finish`.
   */
  finishOrQueue(id: string, body: { endedAt: string; keepRoutine?: true }, meta: FinishMeta): Promise<FinishOutcome>;
  deleteWorkout(id: string): Promise<void>;
  addExercise(workoutId: string, body: { exerciseId: string }): Promise<WorkoutExercise>;
  /** Spec 10.1 AC11: exactly the keys given go on the wire. No `notes` — a regroup must never overwrite a note copied from the routine (Spec 09 D22). */
  updateWorkoutExercise(id: string, body: WorkoutExercisePatch): Promise<WorkoutExercise>;
  moveExercise(id: string, position: number): Promise<WorkoutExercise>;
  removeExercise(id: string): Promise<void>;
  createSet(workoutExerciseId: string, body: CreateSet, options?: SendOptions): Promise<SetEntry>;
  updateSet(id: string, body: UpdateSet, options?: SendOptions): Promise<SetEntry>;
  deleteSet(id: string, options?: SendOptions): Promise<void>;
  /**
   * Spec 10.3 AC28: exactly { notes } goes on the wire. A separate method on purpose — WorkoutExercisePatch has no
   * `notes`, so a regroup can never overwrite a note (Spec 10.1 AC11).
   */
  setExerciseNote(id: string, notes: string | null, options?: SendOptions): Promise<WorkoutExercise>;
  /** Spec 18.0 AC54: `PATCH /v1/workouts/{id}` with exactly the keys given. Online-only: the queued client passes it through. */
  updateWorkout(id: string, body: WorkoutUpdate): Promise<UpdatedWorkout>;
  /** Spec 10.6 AC6 / 10.7 AC15: `POST /v1/workouts/{id}/sections` with `{ name, notes?, timer? }`. Online-only (passed through). */
  addSection(workoutId: string, body: CreateWorkoutSection): Promise<WorkoutSection>;
  /** Spec 10.6 AC7 / 10.7 AC15–AC16: exactly the keys given; an emptied note is `notes: null`, a removed timer `timer: null`. */
  updateSection(id: string, body: UpdateWorkoutSection): Promise<WorkoutSection>;
  removeSection(id: string): Promise<void>;
  /**
   * Spec 10.6 AC9: exactly `{ sectionId }` on the wire; the server places the exercise. A separate
   * method on purpose — WorkoutExercisePatch has no `sectionId`, so a regroup can never move one.
   */
  setExerciseSection(id: string, sectionId: string | null): Promise<WorkoutExercise>;
  /** Spec 10.7 AC34 / 09.5: one round's time, a keyed set (`{ seconds }` only). The queued client turns it into a `round` op. */
  putRoundTime(sectionId: string, round: number, seconds: number, options?: SendOptions): Promise<WorkoutSection>;
  /** Clears one round (`204`, also when it was never recorded). */
  deleteRoundTime(sectionId: string, round: number, options?: SendOptions): Promise<void>;
  /** The section's result, a keyed set with exactly the given keys. The queued client turns it into a `result` op. */
  putResult(sectionId: string, body: SetSectionResult, options?: SendOptions): Promise<WorkoutSection>;
  /** Clears the result (`204`). */
  deleteResult(sectionId: string, options?: SendOptions): Promise<void>;
}

/** Every id goes into the path as one encoded segment: a route id with `/`, `?` or `#` cannot change the endpoint. */
const seg = encodeURIComponent;

export function createWorkoutClient(
  api: Pick<ApiClient, "get" | "post" | "patch" | "delete" | "request">,
): WorkoutClient {
  /** One request; with a signal (the outbox's deadline, Spec 06.7 AC5) it goes through `request`, which passes it to `fetch`. */
  function call<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body: unknown, schema: ResponseSchema<T> | undefined, options?: SendOptions): Promise<T> {
    if (options?.signal !== undefined || method === "PUT") {
      const init: ApiRequestOptions = { method, schema: schema as ResponseSchema<unknown> | undefined, ...(body !== undefined ? { body } : {}), ...(options?.signal ? { signal: options.signal } : {}) };
      return api.request<T>(path, init);
    }
    if (method === "GET") return api.get(path, schema);
    if (method === "POST") return api.post(path, body, schema);
    if (method === "PATCH") return api.patch(path, body, schema);
    return api.delete(path); // every DELETE here answers 204: no schema, as before
  }
  const client: WorkoutClient = {
    async getActive() {
      try {
        return await api.get("/v1/workouts/active", WorkoutDetailSchema);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    getById: (id, options) => call("GET", `/v1/workouts/${seg(id)}`, undefined, WorkoutDetailSchema, options),
    start: (body) => api.post("/v1/workouts", body, WorkoutSchema),
    finish: (id, body, options) => call("PATCH", `/v1/workouts/${seg(id)}`, body, UpdatedWorkoutSchema, options),
    finishOrQueue: async (id, body) => {
      await client.finish(id, body);
      return { status: "landed" };
    },
    deleteWorkout: async (id) => {
      await api.delete(`/v1/workouts/${seg(id)}`);
    },
    addExercise: (workoutId, body) => api.post(`/v1/workouts/${seg(workoutId)}/exercises`, body, WorkoutExerciseSchema),
    updateWorkoutExercise: (id, body) => {
      const wire: { position?: number; supersetGroup?: number | null } = {};
      if (body.position !== undefined) wire.position = body.position;
      if (body.supersetGroup !== undefined) wire.supersetGroup = body.supersetGroup;
      return api.patch(`/v1/workout-exercises/${seg(id)}`, wire, WorkoutExerciseSchema);
    },
    moveExercise: (id, position) => client.updateWorkoutExercise(id, { position }),
    removeExercise: async (id) => {
      await api.delete(`/v1/workout-exercises/${seg(id)}`);
    },
    createSet: (workoutExerciseId, body, options) =>
      call("POST", `/v1/workout-exercises/${seg(workoutExerciseId)}/sets`, body, SetEntrySchema, options),
    updateSet: (id, body, options) => call("PATCH", `/v1/sets/${seg(id)}`, body, SetEntrySchema, options),
    deleteSet: async (id, options) => {
      await call("DELETE", `/v1/sets/${seg(id)}`, undefined, undefined, options);
    },
    setExerciseNote: (id, notes, options) => call("PATCH", `/v1/workout-exercises/${seg(id)}`, { notes }, WorkoutExerciseSchema, options),
    updateWorkout: (id, body) => {
      const wire: { -readonly [K in keyof WorkoutUpdate]: WorkoutUpdate[K] } = {};
      if (body.title !== undefined) wire.title = body.title;
      if (body.notes !== undefined) wire.notes = body.notes;
      if (body.startedAt !== undefined) wire.startedAt = body.startedAt;
      if (body.tzOffsetMinutes !== undefined) wire.tzOffsetMinutes = body.tzOffsetMinutes;
      if (body.durationSeconds !== undefined) wire.durationSeconds = body.durationSeconds;
      return api.patch(`/v1/workouts/${seg(id)}`, wire, UpdatedWorkoutSchema);
    },
    addSection: (workoutId, body) => {
      const wire: CreateWorkoutSection = { name: body.name };
      if (body.notes !== undefined) wire.notes = body.notes;
      if (body.timer !== undefined) wire.timer = body.timer;
      return api.post(`/v1/workouts/${seg(workoutId)}/sections`, wire, WorkoutSectionSchema);
    },
    updateSection: (id, body) => {
      const wire: UpdateWorkoutSection = {};
      if (body.name !== undefined) wire.name = body.name;
      if (body.notes !== undefined) wire.notes = body.notes;
      if (body.timer !== undefined) wire.timer = body.timer;
      if (body.discardResult !== undefined) wire.discardResult = body.discardResult;
      return api.patch(`/v1/workout-sections/${seg(id)}`, wire, WorkoutSectionSchema);
    },
    removeSection: async (id) => {
      await api.delete(`/v1/workout-sections/${seg(id)}`);
    },
    setExerciseSection: (id, sectionId) =>
      api.patch(`/v1/workout-exercises/${seg(id)}`, { sectionId }, WorkoutExerciseSchema),
    putRoundTime: (sectionId, round, seconds, options) =>
      call("PUT", `/v1/workout-sections/${seg(sectionId)}/round-times/${round}`, { seconds }, WorkoutSectionSchema, options),
    deleteRoundTime: async (sectionId, round, options) => {
      await call("DELETE", `/v1/workout-sections/${seg(sectionId)}/round-times/${round}`, undefined, undefined, options);
    },
    putResult: (sectionId, body, options) =>
      call("PUT", `/v1/workout-sections/${seg(sectionId)}/result`, body, WorkoutSectionSchema, options),
    deleteResult: async (sectionId, options) => {
      await call("DELETE", `/v1/workout-sections/${seg(sectionId)}/result`, undefined, undefined, options);
    },
  };
  return client;
}
