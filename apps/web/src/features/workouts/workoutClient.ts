import {
  SetEntrySchema,
  UpdatedWorkoutSchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  type CreateSet,
  type CreateWorkout,
  type SetEntry,
  type UpdateSet,
  type UpdatedWorkout,
  type Workout,
  type WorkoutDetail,
  type WorkoutExercise,
} from "@sin/core";
import { ApiError, type ApiClient } from "../../api";

/** The keys `updateWorkoutExercise` may send (Spec 10.1 AC11). Deliberately no `notes` (Spec 09 D22). */
export interface WorkoutExercisePatch {
  readonly position?: number;
  readonly supersetGroup?: number | null;
}

/** Spec 18.0 AC54: a finished workout's title and notes (Phase B adds the Change Time keys). */
export interface WorkoutUpdate {
  readonly title?: string | null;
  readonly notes?: string | null;
}

/**
 * The REST seam for the workout screen (Spec 06.1 §6.1). React-free. Every write the screen makes
 * goes through this object so Spec 06.2 can replace it with a queue-backed one; the mutation hooks
 * never call `api.*` directly.
 */
export interface WorkoutClient {
  /** `null` when there is no in-progress workout (the API answers 404). */
  getActive(): Promise<WorkoutDetail | null>;
  getById(id: string): Promise<WorkoutDetail>;
  start(body: CreateWorkout): Promise<Workout>;
  /** The workout plus `newRecords` (Spec 07.0 D12): parsed with `UpdatedWorkoutSchema` so Zod keeps it (Spec 08.0 AC5). */
  finish(id: string, body: { endedAt: string }): Promise<UpdatedWorkout>;
  deleteWorkout(id: string): Promise<void>;
  addExercise(workoutId: string, body: { exerciseId: string }): Promise<WorkoutExercise>;
  /** Spec 10.1 AC11: exactly the keys given go on the wire. No `notes` — a regroup must never overwrite a note copied from the routine (Spec 09 D22). */
  updateWorkoutExercise(id: string, body: WorkoutExercisePatch): Promise<WorkoutExercise>;
  moveExercise(id: string, position: number): Promise<WorkoutExercise>;
  removeExercise(id: string): Promise<void>;
  createSet(workoutExerciseId: string, body: CreateSet): Promise<SetEntry>;
  updateSet(id: string, body: UpdateSet): Promise<SetEntry>;
  deleteSet(id: string): Promise<void>;
  /**
   * Spec 10.3 AC28: exactly { notes } goes on the wire. A separate method on purpose — WorkoutExercisePatch has no
   * `notes`, so a regroup can never overwrite a note (Spec 10.1 AC11).
   */
  setExerciseNote(id: string, notes: string | null): Promise<WorkoutExercise>;
  /** Spec 18.0 AC54: `PATCH /v1/workouts/{id}` with exactly the keys given. Online-only: the queued client passes it through. */
  updateWorkout(id: string, body: WorkoutUpdate): Promise<UpdatedWorkout>;
}

/** Every id goes into the path as one encoded segment: a route id with `/`, `?` or `#` cannot change the endpoint. */
const seg = encodeURIComponent;

export function createWorkoutClient(
  api: Pick<ApiClient, "get" | "post" | "patch" | "delete">,
): WorkoutClient {
  const client: WorkoutClient = {
    async getActive() {
      try {
        return await api.get("/v1/workouts/active", WorkoutDetailSchema);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    getById: (id) => api.get(`/v1/workouts/${seg(id)}`, WorkoutDetailSchema),
    start: (body) => api.post("/v1/workouts", body, WorkoutSchema),
    finish: (id, body) => api.patch(`/v1/workouts/${seg(id)}`, body, UpdatedWorkoutSchema),
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
    createSet: (workoutExerciseId, body) =>
      api.post(`/v1/workout-exercises/${seg(workoutExerciseId)}/sets`, body, SetEntrySchema),
    updateSet: (id, body) => api.patch(`/v1/sets/${seg(id)}`, body, SetEntrySchema),
    deleteSet: async (id) => {
      await api.delete(`/v1/sets/${seg(id)}`);
    },
    setExerciseNote: (id, notes) => api.patch(`/v1/workout-exercises/${seg(id)}`, { notes }, WorkoutExerciseSchema),
    updateWorkout: (id, body) => {
      const wire: { title?: string | null; notes?: string | null } = {};
      if (body.title !== undefined) wire.title = body.title;
      if (body.notes !== undefined) wire.notes = body.notes;
      return api.patch(`/v1/workouts/${seg(id)}`, wire, UpdatedWorkoutSchema);
    },
  };
  return client;
}
