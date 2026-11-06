import { SET_WORK_S } from "./constants.ts";
import { finishBody, setBody, startBody } from "./payloads.ts";
import { createRng } from "./rng.ts";
import { nextActionOnStartConflict, type Action, type ReadName } from "./session.ts";
import { routeName, type TagKey } from "./tags.ts";

/**
 * Spec 16 AC2 — one lifter following its plan. Pure over `io`: k6 supplies real requests and sleeps, tests a fake.
 * A failed request is recorded by k6 (status and tags) and never retried (§6.2).
 */
export interface ExecutorIo {
  request(method: string, path: string, body?: unknown): { status: number; json(): unknown };
  sleep(seconds: number): void;
  tag(tags: Partial<Record<TagKey, string>>): void;
}

export interface LifterState {
  rng: () => number;
  routineId: string;
  /** Planned working weight per routine item; `null` = bodyweight (no weight sent). */
  plannedWeights: (number | null)[];
  workoutId: string | null;
  /** The live workout's exercises in position order (kept after finish so Progress can name one). */
  exercises: { id: string; exerciseId: string }[];
  now: () => Date;
}

export function newLifterState(opts: {
  seed: number;
  routineId: string;
  plannedWeights: (number | null)[];
  now?: () => Date;
}): LifterState {
  return {
    rng: createRng(opts.seed),
    routineId: opts.routineId,
    plannedWeights: opts.plannedWeights,
    workoutId: null,
    exercises: [],
    now: opts.now ?? (() => new Date()),
  };
}

const READ_PATHS: Record<ReadName, string> = {
  me: "/v1/me",
  exercises: "/v1/exercises",
  muscle_groups: "/v1/muscle-groups",
  equipment: "/v1/equipment",
  routines: "/v1/routines",
  workout_active: "/v1/workouts/active",
  personal_records: "/v1/personal-records",
};

function send(io: ExecutorIo, method: string, path: string, body?: unknown) {
  io.tag({ name: routeName(method, path) });
  return io.request(method, path, body);
}

/** Like the web app after a start: read the live workout to learn its exercises. */
function loadActive(io: ExecutorIo, state: LifterState): void {
  const res = send(io, "GET", "/v1/workouts/active");
  if (res.status !== 200) {
    state.workoutId = null;
    return;
  }
  const detail = res.json() as { id: string; exercises: { id: string; exerciseId: string; position: number }[] };
  state.workoutId = detail.id;
  state.exercises = [...detail.exercises].sort((a, b) => a.position - b.position).map((e) => ({ id: e.id, exerciseId: e.exerciseId }));
}

export function runActions(actions: Action[], io: ExecutorIo, state: LifterState): void {
  for (const action of actions) {
    switch (action.kind) {
      case "read":
        send(io, "GET", READ_PATHS[action.name]);
        break;
      case "start": {
        const res = send(io, "POST", "/v1/workouts", startBody(state.routineId, state.rng, state.now()));
        if (res.status === 200 || res.status === 201 || nextActionOnStartConflict(res.status) === "adopt_active") loadActive(io, state);
        else state.workoutId = null;
        break;
      }
      case "set": {
        const target = state.workoutId === null ? undefined : state.exercises[action.itemIndex];
        if (!target) break;
        io.sleep(SET_WORK_S);
        send(io, "POST", `/v1/workout-exercises/${target.id}/sets`, setBody(state.rng, state.plannedWeights[action.itemIndex] ?? null));
        break;
      }
      case "rest":
        io.sleep(action.seconds);
        break;
      case "finish":
        if (state.workoutId === null) break;
        send(io, "PATCH", `/v1/workouts/${state.workoutId}`, finishBody(state.now()));
        state.workoutId = null;
        break;
      case "history":
        send(io, "GET", "/v1/workouts?limit=20");
        break;
      case "progress": {
        const exercise = state.exercises[action.itemIndex];
        if (exercise) send(io, "GET", `/v1/progress/exercises/${exercise.exerciseId}`);
        break;
      }
    }
  }
}
