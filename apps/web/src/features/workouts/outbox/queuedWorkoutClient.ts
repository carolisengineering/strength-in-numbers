import type { SetEntry, WorkoutDetail } from "@sin/core";
import type { WorkoutClient } from "../workoutClient";
import type { Outbox } from "./outbox";
import { matches, project } from "./project";

export interface QueuedClientDeps {
  rest: WorkoutClient;
  outbox: Outbox;
  /** The cached active workout (already projected), read from TanStack Query by the provider. */
  cached: () => WorkoutDetail | null | undefined;
}

/**
 * The screen's `WorkoutClient` (Spec 06.2 AC10): set writes go to the outbox and resolve at once with
 * what the screen should show; reads overlay the outbox; everything else is the REST client's. A set
 * write for a workout that is not cached (not reachable from the session screen) falls back to REST.
 */
export function createQueuedWorkoutClient({ rest, outbox, cached }: QueuedClientDeps): WorkoutClient {
  const view = (workout: WorkoutDetail) => project(workout, outbox.getState()).workout;

  const exerciseOfSet = (workout: WorkoutDetail, setId: string) =>
    workout.exercises.find((e) => e.sets.some((s) => s.id === setId));

  const rowIn = (workout: WorkoutDetail, find: (s: SetEntry) => boolean): SetEntry => {
    for (const exercise of workout.exercises) {
      const row = exercise.sets.find(find);
      if (row) return row;
    }
    throw new Error("projected row not found");
  };

  return {
    ...rest,

    async getActive() {
      const server = await rest.getActive();
      outbox.retainOnly(server?.id ?? null);
      return server === null ? null : view(server);
    },

    async createSet(workoutExerciseId, body) {
      const workout = cached();
      if (!workout?.exercises.some((e) => e.id === workoutExerciseId)) return rest.createSet(workoutExerciseId, body);
      const clientGeneratedId = body.clientGeneratedId ?? crypto.randomUUID();
      outbox.enqueueCreate({ workoutId: workout.id, workoutExerciseId, body: { ...body, clientGeneratedId } });
      const target = { clientGeneratedId };
      return rowIn(view(workout), (s) => matches(s, target, outbox.getState().idMap));
    },

    async updateSet(id, body) {
      const workout = cached();
      const exercise = workout ? exerciseOfSet(workout, id) : undefined;
      if (!workout || !exercise) return rest.updateSet(id, body);
      outbox.enqueueUpdate({ workoutId: workout.id, workoutExerciseId: exercise.id, target: outbox.targetFor(id), body });
      return rowIn(view(workout), (s) => s.id === id);
    },

    async deleteSet(id) {
      const workout = cached();
      const exercise = workout ? exerciseOfSet(workout, id) : undefined;
      if (!workout || !exercise) return rest.deleteSet(id);
      outbox.enqueueDelete({ workoutId: workout.id, workoutExerciseId: exercise.id, target: outbox.targetFor(id) });
    },
  };
}
