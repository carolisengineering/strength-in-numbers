import { uuidv7 } from "uuidv7";
import type { RouteKey } from "./registry.js";
import type { World } from "./world.js";

/**
 * Spec 21.0 §5 — the cross-user case table. One or more cases per non-exempt
 * `/v1` route. The runner (`cross-user-routes.integration.test.ts`) executes
 * every case; the coverage gate (`gate.ts`) fails on any route or id slot
 * nobody covered.
 *
 * A `foreign-id` case is called twice by the actor: once with B's id in the
 * slot and once with a fresh id that exists nowhere; the two answers must be
 * the same after substituting the ids (AC8), and equal to `expect`.
 */

export type Actor = "A" | "C";

export interface Req {
  method: string;
  url: string;
  body?: unknown;
}

export interface ControlReq extends Req {
  expectStatus: number;
  /** For reads: an id of A's that the response body must contain. */
  expectId?: string;
}

export interface CaseResponse {
  status: number;
  headers: Record<string, unknown>;
  body: string;
}

/** What a case's setup and checks can call: the app as any world user. */
export interface CaseApi {
  call(actor: "A" | "B" | "C", req: Req): Promise<CaseResponse>;
  /** Calls and fails unless the status matches; returns the parsed body. */
  must(actor: "A" | "B" | "C", req: Req, status: number): Promise<{ id: string; [key: string]: unknown }>;
}

export interface CrossUserCase {
  route: RouteKey;
  name: string;
  /** The id slots (`idSlots` paths) this case exercises. */
  covers: string[];
  /**
   * - `foreign-id`: B's id and a fresh id must answer alike (AC8).
   * - `collection`: a read whose body must hold only the actor's data (AC13).
   * - `collision`: A reuses one of B's keys and gets a new row of its own (AC14).
   * - `write-isolation`: a write with no foreign id; B must be unchanged (AC9).
   */
  kind: "foreign-id" | "collection" | "collision" | "write-isolation";
  /** The status pinned from spec §5 (for `foreign-id`, the answer to both calls). */
  expect: { status: number };
  actor: Actor;
  /** B's id for the slot (`foreign-id` only). */
  foreignId?(w: World): string;
  /** The request; `foreign-id` cases put `slotValue` where B's id goes. */
  call(w: World, slotValue?: string): Req;
  /** Creates what the case needs on the actor's side; its result is passed to `call` (non-foreign kinds) and `control`. */
  disposable?(w: World, api: CaseApi): Promise<string>;
  /** The same request on A's own data (AC11). */
  control(w: World, scratch?: string): ControlReq;
  /** Extra checks on the case's response, for collections and collisions. */
  check?(w: World, res: CaseResponse, api: CaseApi): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const methodOf = (route: RouteKey) => route.slice(0, route.indexOf(" "));
const urlOf = (route: RouteKey) => route.slice(route.indexOf(" ") + 1);

/** The route's URL with `:id` set and `:round` = 1. */
const fill = (route: RouteKey, id: string) => urlOf(route).replace(":id", id).replace(":round", "1");

interface PathCaseSpec {
  route: RouteKey;
  name: string;
  foreign: (w: World) => string;
  body?: (w: World) => unknown;
  /** Spec §5's answer; 404 unless the row says otherwise. */
  expect?: number;
  /** A's own id for the control, or `disposable` creates one. */
  own?: (w: World) => string;
  /** Its result's first word is the control's id; the rest is passed to `controlBody`. */
  disposable?: CrossUserCase["disposable"];
  controlBody?: (w: World, scratch?: string) => unknown;
  controlStatus: number;
  /** For reads: the control's body must hold A's id. */
  controlExpectsOwnId?: boolean;
}

/** A `foreign-id` case whose slot is the path `:id`. */
function pathCase(s: PathCaseSpec): CrossUserCase {
  const method = methodOf(s.route);
  return {
    route: s.route,
    name: s.name,
    covers: ["params.id"],
    kind: "foreign-id",
    expect: { status: s.expect ?? 404 },
    actor: "A",
    foreignId: s.foreign,
    call: (w, id) => ({ method, url: fill(s.route, id!), ...(s.body ? { body: s.body(w) } : {}) }),
    ...(s.disposable ? { disposable: s.disposable } : {}),
    control: (w, scratch) => {
      const id = scratch?.split(" ")[0] ?? s.own!(w);
      const body = s.controlBody ?? s.body;
      return {
        method,
        url: fill(s.route, id),
        ...(body ? { body: body(w, scratch) } : {}),
        expectStatus: s.controlStatus,
        ...(s.controlExpectsOwnId ? { expectId: id } : {}),
      };
    },
  };
}

// Disposable resources for destructive controls (AC11).

const newExercise: CrossUserCase["disposable"] = async (_w, api) =>
  (await api.must("A", { method: "POST", url: "/v1/exercises", body: { name: `A-OWN-disposable-${uuidv7()}`, modality: "weight_reps" } }, 201)).id;

const newRoutine: CrossUserCase["disposable"] = async (w, api) =>
  (await api.must("A", { method: "POST", url: "/v1/routines", body: routineBody(w.a.customExercise, `A-OWN-disposable-${uuidv7()}`) }, 201)).id;

/** A finished workout of A's, imported from Hevy (A always has a live workout, so it can't start another). */
const newFinishedWorkout: CrossUserCase["disposable"] = async (_w, api) => {
  const res = await api.must(
    "A",
    {
      method: "POST",
      url: "/v1/hevy/import/workouts",
      body: {
        dryRun: false,
        workouts: [
          {
            hevyWorkoutId: `disposable-${uuidv7()}`,
            title: "A-OWN-disposable",
            description: null,
            startTime: "2026-09-01T10:00:00Z",
            endTime: "2026-09-01T11:00:00Z",
            tzOffsetMinutes: 0,
            exercises: [
              {
                exerciseTemplateId: "T-CROSS-SHARED",
                notes: null,
                supersetId: null,
                sets: [{ type: "normal", weightKg: 40, reps: 5, distanceMeters: null, durationSeconds: null, rpe: null, customMetric: null }],
              },
            ],
          },
        ],
      },
    },
    200,
  );
  const workoutId = (res.results as { workoutId?: string }[] | undefined)?.[0]?.workoutId;
  if (!workoutId) throw new Error(`disposable workout: the import created none: ${JSON.stringify(res)}`);
  return workoutId;
};

const newLiveExercise: CrossUserCase["disposable"] = async (w, api) =>
  (await api.must("A", { method: "POST", url: `/v1/workouts/${w.a.liveWorkout}/exercises`, body: { exerciseId: w.globalExercise } }, 201)).id;

const newLiveSet: CrossUserCase["disposable"] = async (w, api) =>
  (await api.must("A", { method: "POST", url: `/v1/workout-exercises/${w.a.liveWorkoutExercise}/sets`, body: { reps: 3 } }, 201)).id;

const newLiveSection: CrossUserCase["disposable"] = async (w, api) =>
  (await api.must("A", { method: "POST", url: `/v1/workouts/${w.a.liveWorkout}/sections`, body: { name: "A-OWN-disposable" } }, 201)).id;

/** A Hevy claim on a disposable finished workout of A's; returns `"<workout id> <claim fingerprint>"`. */
const newClaimedWorkout: CrossUserCase["disposable"] = async (w, api) => {
  const workoutId = await newFinishedWorkout(w, api);
  const begin = await api.must("A", { method: "POST", url: `/v1/workouts/${workoutId}/hevy-link`, body: { relink: true } }, 200);
  return `${workoutId} ${String(begin.fingerprint)}`;
};

/** A whole routine document with one item. */
export function routineBody(exerciseId: string, name: string) {
  return { name, notes: null, items: [{ exerciseId, targetSets: 1, targetRepsLow: 5, targetRepsHigh: 5 }] };
}

/** A well-formed fingerprint that matches no claim. */
const FINGERPRINT = `v1:${"0".repeat(64)}`;

// ---------------------------------------------------------------------------
// Spec §5 — path-id cases (rows 8, 10–12, 18–33, 35, 37–39, 41, 46–49)
// ---------------------------------------------------------------------------

const PATH_ID_CASES: CrossUserCase[] = [
  // Exercises (rows 8, 10–12, 41)
  pathCase({
    route: "GET /v1/exercises/:id/routines",
    name: "B's custom exercise",
    foreign: (w) => w.b.customExercise,
    own: (w) => w.a.customExercise,
    controlStatus: 200,
  }),
  pathCase({
    route: "PATCH /v1/exercises/:id",
    name: "B's custom exercise",
    foreign: (w) => w.b.customExercise,
    body: () => ({ name: "Renamed by A" }),
    own: (w) => w.a.customExercise,
    controlBody: (w) => ({ name: w.a.exerciseName }),
    controlStatus: 200,
    controlExpectsOwnId: true,
  }),
  pathCase({
    route: "POST /v1/exercises/:id/fork",
    name: "B's custom exercise",
    foreign: (w) => w.b.customExercise,
    own: (w) => w.globalExercise,
    controlStatus: 201,
  }),
  pathCase({
    route: "DELETE /v1/exercises/:id",
    name: "B's custom exercise",
    foreign: (w) => w.b.customExercise,
    disposable: newExercise,
    controlStatus: 204,
  }),
  pathCase({
    route: "GET /v1/progress/exercises/:id",
    name: "B's custom exercise",
    foreign: (w) => w.b.customExercise,
    own: (w) => w.a.customExercise,
    controlStatus: 200,
  }),

  // Workouts (rows 18–21, 27)
  pathCase({
    route: "GET /v1/workouts/:id",
    name: "B's finished workout",
    foreign: (w) => w.b.finishedWorkout,
    own: (w) => w.a.finishedWorkout,
    controlStatus: 200,
    controlExpectsOwnId: true,
  }),
  pathCase({
    route: "PATCH /v1/workouts/:id",
    name: "B's finished workout",
    foreign: (w) => w.b.finishedWorkout,
    body: () => ({ title: "Retitled by A" }),
    own: (w) => w.a.finishedWorkout,
    controlStatus: 200,
    controlExpectsOwnId: true,
  }),
  pathCase({
    route: "DELETE /v1/workouts/:id",
    name: "B's finished workout",
    foreign: (w) => w.b.finishedWorkout,
    disposable: newFinishedWorkout,
    controlStatus: 204,
  }),
  pathCase({
    route: "POST /v1/workouts/:id/exercises",
    name: "B's live workout",
    foreign: (w) => w.b.liveWorkout,
    body: (w) => ({ exerciseId: w.globalExercise }),
    own: (w) => w.a.liveWorkout,
    controlStatus: 201,
  }),
  pathCase({
    route: "POST /v1/workouts/:id/sections",
    name: "B's live workout",
    foreign: (w) => w.b.liveWorkout,
    body: () => ({ name: "Added by A" }),
    own: (w) => w.a.liveWorkout,
    controlStatus: 201,
  }),

  // Workout exercises and sets (rows 22–26)
  pathCase({
    route: "PATCH /v1/workout-exercises/:id",
    name: "B's workout exercise",
    foreign: (w) => w.b.liveWorkoutExercise,
    body: () => ({ notes: "Noted by A" }),
    own: (w) => w.a.liveWorkoutExercise,
    controlStatus: 200,
    controlExpectsOwnId: true,
  }),
  pathCase({
    route: "DELETE /v1/workout-exercises/:id",
    name: "B's workout exercise",
    foreign: (w) => w.b.liveWorkoutExercise,
    disposable: newLiveExercise,
    controlStatus: 204,
  }),
  pathCase({
    route: "POST /v1/workout-exercises/:id/sets",
    name: "B's workout exercise",
    foreign: (w) => w.b.liveWorkoutExercise,
    body: () => ({ reps: 5 }),
    own: (w) => w.a.liveWorkoutExercise,
    controlStatus: 201,
  }),
  pathCase({
    route: "PATCH /v1/sets/:id",
    name: "B's set",
    foreign: (w) => w.b.liveSet,
    body: () => ({ reps: 6 }),
    own: (w) => w.a.liveSet,
    controlStatus: 200,
    controlExpectsOwnId: true,
  }),
  pathCase({
    route: "DELETE /v1/sets/:id",
    name: "B's set",
    foreign: (w) => w.b.liveSet,
    disposable: newLiveSet,
    controlStatus: 204,
  }),

  // Workout sections (rows 28–33)
  pathCase({
    route: "PATCH /v1/workout-sections/:id",
    name: "B's section",
    foreign: (w) => w.b.liveSection,
    body: () => ({ name: "Renamed by A" }),
    own: (w) => w.a.liveSection,
    controlBody: () => ({ name: "A-OWN-live-section" }),
    controlStatus: 200,
    controlExpectsOwnId: true,
  }),
  pathCase({
    route: "DELETE /v1/workout-sections/:id",
    name: "B's section",
    foreign: (w) => w.b.liveSection,
    disposable: newLiveSection,
    controlStatus: 204,
  }),
  pathCase({
    route: "PUT /v1/workout-sections/:id/round-times/:round",
    name: "B's timed section",
    foreign: (w) => w.b.finishedSection,
    body: () => ({ seconds: 240 }),
    own: (w) => w.a.finishedSection,
    controlStatus: 200,
    controlExpectsOwnId: true,
  }),
  pathCase({
    route: "DELETE /v1/workout-sections/:id/round-times/:round",
    name: "B's timed section",
    foreign: (w) => w.b.finishedSection,
    // Round 1 of A's timed section is cleared and put back by the PUT case's control (a keyed set, AC11).
    own: (w) => w.a.finishedSection,
    controlStatus: 204,
  }),
  pathCase({
    route: "PUT /v1/workout-sections/:id/result",
    name: "B's timed section",
    foreign: (w) => w.b.finishedSection,
    body: () => ({ rounds: 3, reps: 4 }),
    own: (w) => w.a.finishedSection,
    controlStatus: 200,
    controlExpectsOwnId: true,
  }),
  pathCase({
    route: "DELETE /v1/workout-sections/:id/result",
    name: "B's timed section",
    foreign: (w) => w.b.finishedSection,
    own: (w) => w.a.finishedSection,
    controlStatus: 204,
  }),

  // Routines (rows 35, 37–39)
  pathCase({
    route: "GET /v1/routines/:id",
    name: "B's routine",
    foreign: (w) => w.b.routine,
    own: (w) => w.a.routine,
    controlStatus: 200,
    controlExpectsOwnId: true,
  }),
  pathCase({
    route: "PUT /v1/routines/:id",
    name: "B's routine",
    foreign: (w) => w.b.routine,
    body: (w) => routineBody(w.a.customExercise, "Replaced by A"),
    disposable: newRoutine,
    controlStatus: 200,
  }),
  pathCase({
    route: "POST /v1/routines/:id/keep",
    name: "B's one-off routine",
    foreign: (w) => w.b.oneOffRoutine,
    own: (w) => w.a.oneOffRoutine,
    controlStatus: 204,
  }),
  pathCase({
    route: "DELETE /v1/routines/:id",
    name: "B's routine",
    foreign: (w) => w.b.routine,
    disposable: newRoutine,
    controlStatus: 204,
  }),

  // Hevy links (rows 46–49)
  pathCase({
    route: "GET /v1/workouts/:id/hevy-link",
    name: "B's linked workout",
    foreign: (w) => w.b.finishedWorkout,
    own: (w) => w.a.finishedWorkout,
    controlStatus: 200,
  }),
  pathCase({
    route: "POST /v1/workouts/:id/hevy-link",
    name: "B's linked workout",
    foreign: (w) => w.b.finishedWorkout,
    body: () => ({ relink: true }),
    disposable: newFinishedWorkout,
    controlStatus: 200,
  }),
  pathCase({
    route: "PUT /v1/workouts/:id/hevy-link",
    name: "B's linked workout",
    foreign: (w) => w.b.finishedWorkout,
    body: () => ({ hevyWorkoutId: "hevy-by-a", fingerprint: FINGERPRINT }),
    disposable: newClaimedWorkout,
    controlBody: (_w, scratch) => ({ hevyWorkoutId: `hevy-by-a-${uuidv7()}`, fingerprint: scratch!.split(" ")[1] }),
    controlStatus: 200,
  }),
  pathCase({
    route: "DELETE /v1/workouts/:id/hevy-link",
    name: "B's linked workout",
    foreign: (w) => w.b.finishedWorkout,
    disposable: newClaimedWorkout,
    controlStatus: 204,
  }),
];

export const CASES: CrossUserCase[] = [...PATH_ID_CASES];
