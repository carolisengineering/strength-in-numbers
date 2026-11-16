import type { SetEntry, WorkoutDetail, WorkoutSection } from "@sin/core";
import type { WorkoutClient } from "../workoutClient";
import { FINISH_WAIT_MS, waitingFinishOf, withQueuedFinish } from "./finish";
import type { Outbox } from "./outbox";
import { matches, project } from "./project";

/**
 * Spec 06.7 AC2, minor 613: a write to a workout whose finish is waiting was refused by the outbox. The screens never
 * offer one; if one gets through, it fails loudly instead of looking saved.
 */
export class WorkoutFinishingError extends Error {
  constructor() {
    super("workout is finishing: write refused");
    this.name = "WorkoutFinishingError";
  }
}

/** Throws when the outbox refused the write. */
function queued(accepted: boolean): void {
  if (!accepted) throw new WorkoutFinishingError();
}

export interface QueuedClientDeps {
  rest: WorkoutClient;
  outbox: Outbox;
  /** The cached active workout (already projected), read from TanStack Query by the provider. */
  cached: () => WorkoutDetail | null | undefined;
  /** Spec 06.7 AC16: the cached `["workouts","detail",id]`, so the summary of a waiting finish needs no request. */
  cachedDetail?: (id: string) => WorkoutDetail | undefined;
  /**
   * Spec 06.7 AC14: finish op ids a tap is waiting on, within `FINISH_WAIT_MS`. The provider's landing effects read it:
   * a finish that lands in that wait was never shown as "saved on this phone" (`workout_finished.queued` is false).
   */
  finishWaits?: Set<string>;
}

/**
 * The screen's `WorkoutClient` (Spec 06.2 AC10): set writes go to the outbox and resolve at once with
 * what the screen should show; reads overlay the outbox; everything else is the REST client's. A set
 * write for a workout that is not cached (not reachable from the session screen) falls back to REST.
 */
export function createQueuedWorkoutClient({ rest, outbox, cached, cachedDetail, finishWaits }: QueuedClientDeps): WorkoutClient {
  const view = (workout: WorkoutDetail) => project(workout, outbox.getState()).workout;

  /**
   * The exercise holding the set the screen called `setId`. A sheet opened on a pending set keeps its
   * client key after the set syncs and the cache row takes the server id, so match through the id map.
   */
  const exerciseOfSet = (workout: WorkoutDetail, setId: string) => {
    const target = outbox.targetFor(setId);
    const { idMap } = outbox.getState();
    return workout.exercises.find((e) => e.sets.some((s) => s.id === setId || matches(s, target, idMap)));
  };

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
      outbox.settle(server?.id ?? null);
      return server === null ? null : view(server);
    },

    /**
     * Spec 06.7 AC16: while a finish waits, the summary reads the finished copy — the cached one (no request) or the
     * server's — with the outbox overlay and the op's `endedAt`. A failure of that read rejects as it is: no half-built workout.
     */
    async getById(id, options) {
      if (!waitingFinishOf(id, outbox.getState().ops)) return rest.getById(id, options);
      const active = cached();
      const copy = cachedDetail?.(id) ?? (active?.id === id ? active : undefined) ?? (await rest.getById(id, options));
      return withQueuedFinish(view(copy), outbox.getState().ops);
    },

    /**
     * Spec 06.7 AC13, §6.3: enqueue the finish (persisted before `durable` is read), then wait up to `FINISH_WAIT_MS`
     * for it to land, unless the outbox knows the browser is offline. Never rejects for the send's sake: that is the op's.
     */
    async finishOrQueue(id, body, meta) {
      const opId = outbox.enqueueFinish({ workoutId: id, body, meta });
      const queued = (reason: "offline" | "slow") => ({ status: "queued" as const, reason, durable: outbox.getState().durable });
      if (!outbox.getState().online) return queued("offline");
      finishWaits?.add(opId);
      try {
        return (await outbox.whenFinishSettles(opId, FINISH_WAIT_MS)) === "landed" ? { status: "landed" } : queued("slow");
      } finally {
        finishWaits?.delete(opId);
      }
    },

    async createSet(workoutExerciseId, body) {
      const workout = cached();
      if (!workout?.exercises.some((e) => e.id === workoutExerciseId)) return rest.createSet(workoutExerciseId, body);
      const clientGeneratedId = body.clientGeneratedId ?? crypto.randomUUID();
      queued(outbox.enqueueCreate({ workoutId: workout.id, workoutExerciseId, body: { ...body, clientGeneratedId } }));
      const target = { clientGeneratedId };
      return rowIn(view(workout), (s) => matches(s, target, outbox.getState().idMap));
    },

    async updateSet(id, body) {
      const workout = cached();
      const exercise = workout ? exerciseOfSet(workout, id) : undefined;
      if (!workout || !exercise) return rest.updateSet(id, body);
      const target = outbox.targetFor(id);
      queued(outbox.enqueueUpdate({ workoutId: workout.id, workoutExerciseId: exercise.id, target, body }));
      return rowIn(view(workout), (s) => s.id === id || matches(s, target, outbox.getState().idMap));
    },

    async setExerciseNote(id, notes) {
      const workout = cached();
      if (!workout?.exercises.some((e) => e.id === id)) return rest.setExerciseNote(id, notes);
      queued(outbox.enqueueNote({ workoutId: workout.id, workoutExerciseId: id, body: { notes } }));
      return view(workout).exercises.find((e) => e.id === id)!;
    },

    async deleteSet(id) {
      const workout = cached();
      const exercise = workout ? exerciseOfSet(workout, id) : undefined;
      if (!workout || !exercise) return rest.deleteSet(id);
      queued(outbox.enqueueDelete({ workoutId: workout.id, workoutExerciseId: exercise.id, target: outbox.targetFor(id) }));
    },

    // Spec 10.7 AC34: a timer entry on a section of the cached workout is queued and resolves at once with the
    // projected section; one on any other section goes over REST.
    async putRoundTime(sectionId, round, seconds) {
      const workout = workoutWithSection(sectionId);
      if (!workout) return rest.putRoundTime(sectionId, round, seconds);
      queued(outbox.enqueueRound({ workoutId: workout.id, sectionId, round, body: { seconds } }));
      return projectedSection(workout, sectionId);
    },

    async deleteRoundTime(sectionId, round) {
      const workout = workoutWithSection(sectionId);
      if (!workout) return rest.deleteRoundTime(sectionId, round);
      queued(outbox.enqueueRound({ workoutId: workout.id, sectionId, round, body: { seconds: null } }));
    },

    async putResult(sectionId, body) {
      const workout = workoutWithSection(sectionId);
      if (!workout) return rest.putResult(sectionId, body);
      queued(outbox.enqueueResult({ workoutId: workout.id, sectionId, body }));
      return projectedSection(workout, sectionId);
    },

    async deleteResult(sectionId) {
      const workout = workoutWithSection(sectionId);
      if (!workout) return rest.deleteResult(sectionId);
      queued(outbox.enqueueResult({ workoutId: workout.id, sectionId, body: null }));
    },
  };

  function workoutWithSection(sectionId: string): WorkoutDetail | null {
    const workout = cached();
    return workout && workout.sections.some((s) => s.id === sectionId) ? workout : null;
  }

  function projectedSection(workout: WorkoutDetail, sectionId: string): WorkoutSection {
    return view(workout).sections.find((s) => s.id === sectionId)!;
  }
}
