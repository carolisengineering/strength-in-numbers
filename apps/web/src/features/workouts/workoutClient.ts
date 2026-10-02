import {
  SetEntrySchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  type CreateSet,
  type CreateWorkout,
  type SetEntry,
  type UpdateSet,
  type Workout,
  type WorkoutDetail,
  type WorkoutExercise,
} from "@sin/core";
import { ApiError, type ApiClient } from "../../api";

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
  finish(id: string, body: { endedAt: string }): Promise<Workout>;
  deleteWorkout(id: string): Promise<void>;
  addExercise(workoutId: string, body: { exerciseId: string }): Promise<WorkoutExercise>;
  moveExercise(id: string, position: number): Promise<WorkoutExercise>;
  removeExercise(id: string): Promise<void>;
  createSet(workoutExerciseId: string, body: CreateSet): Promise<SetEntry>;
  updateSet(id: string, body: UpdateSet): Promise<SetEntry>;
  deleteSet(id: string): Promise<void>;
}

/** Every id goes into the path as one encoded segment: a route id with `/`, `?` or `#` cannot change the endpoint. */
const seg = encodeURIComponent;

export function createWorkoutClient(
  api: Pick<ApiClient, "get" | "post" | "patch" | "delete">,
): WorkoutClient {
  return {
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
    finish: (id, body) => api.patch(`/v1/workouts/${seg(id)}`, body, WorkoutSchema),
    deleteWorkout: async (id) => {
      await api.delete(`/v1/workouts/${seg(id)}`);
    },
    addExercise: (workoutId, body) => api.post(`/v1/workouts/${seg(workoutId)}/exercises`, body, WorkoutExerciseSchema),
    moveExercise: (id, position) => api.patch(`/v1/workout-exercises/${seg(id)}`, { position }, WorkoutExerciseSchema),
    removeExercise: async (id) => {
      await api.delete(`/v1/workout-exercises/${seg(id)}`);
    },
    createSet: (workoutExerciseId, body) =>
      api.post(`/v1/workout-exercises/${seg(workoutExerciseId)}/sets`, body, SetEntrySchema),
    updateSet: (id, body) => api.patch(`/v1/sets/${seg(id)}`, body, SetEntrySchema),
    deleteSet: async (id) => {
      await api.delete(`/v1/sets/${seg(id)}`);
    },
  };
}
