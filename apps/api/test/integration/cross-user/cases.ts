import { uuidv7 } from "uuidv7";
import type { RouteKey } from "./registry.js";
import { B_ONLY, type World } from "./world.js";

const B_ONLY_DAY = B_ONLY.day;

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
  /** A read-only SQL query on the suite's database, for checks that need a stored value. */
  rows<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
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
  /** Who sends the control; the case's actor unless set. */
  controlActor?: "A" | "C";
  /** Extra checks on the case's response, for collections and collisions. */
  check?(w: World, res: CaseResponse, api: CaseApi): Promise<void> | void;
  /** Undoes what the case and its control created, when a later case needs the world as it was (C's one-active slot). */
  cleanup?(w: World, api: CaseApi): Promise<void>;
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
    // B's key with B's workout exercise: were the replay lookup (§6.7 #1) ever reached before the
    // ownership check, B's stored set would come back. The fresh-id call sends the same key.
    name: "B's workout exercise with B's own set key",
    foreign: (w) => w.b.finishedWorkoutExercise,
    body: (w) => ({ clientGeneratedId: w.b.finishedSetClientId, reps: 5 }),
    own: (w) => w.a.liveWorkoutExercise,
    controlBody: () => ({ reps: 5 }),
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
    // Keep turns the one-off into an ordinary routine, so the control keeps a disposable one (AC11).
    disposable: async (w, api) =>
      (await api.must("A", { method: "POST", url: "/v1/routines", body: { ...routineBody(w.a.customExercise, `A-OWN-disposable-${uuidv7()}`), oneOff: true } }, 201)).id,
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

// ---------------------------------------------------------------------------
// Spec §5 — body and query ids (rows 15, 21, 22, 36, 37, 40, 44, 45)
// ---------------------------------------------------------------------------

interface SlotCaseSpec {
  route: RouteKey;
  name: string;
  slot: string;
  actor?: Actor;
  foreign: (w: World) => string;
  /** The request with `id` in the slot; everything else identical between the two calls. */
  req: (w: World, id: string) => Req;
  expect: number;
  control: (w: World, scratch?: string) => ControlReq;
  disposable?: CrossUserCase["disposable"];
  cleanup?: CrossUserCase["cleanup"];
}

function slotCase(s: SlotCaseSpec): CrossUserCase {
  return {
    route: s.route,
    name: s.name,
    covers: [s.slot],
    kind: "foreign-id",
    expect: { status: s.expect },
    actor: s.actor ?? "A",
    foreignId: s.foreign,
    call: (w, id) => s.req(w, id!),
    control: s.control,
    ...(s.disposable ? { disposable: s.disposable } : {}),
    ...(s.cleanup ? { cleanup: s.cleanup } : {}),
  };
}

/** One key for both calls of the row 15 case: the rejected start is rolled back, so it never replays. */
const C_START_KEY = uuidv7();

/** C's live workout, if any, is deleted so C keeps "no live workout" for the next case. */
const deleteCsLiveWorkout: CrossUserCase["cleanup"] = async (_w, api) => {
  const active = await api.call("C", { method: "GET", url: "/v1/workouts/active" });
  if (active.status !== 200) return;
  const id = (JSON.parse(active.body) as { id: string }).id;
  await api.must("C", { method: "DELETE", url: `/v1/workouts/${id}` }, 204);
};

/** A's Hevy mapping exactly as the world built it, with `exerciseId` on the shared pair. */
const aMapping = (exerciseId: string) => ({
  pairs: [
    {
      hevyTemplateId: "T-CROSS-SHARED",
      hevyTitle: "A-OWN-hevy-title",
      hevyType: "weight_reps",
      role: "exercise",
      exerciseId,
      measureRule: null,
      exportAs: true,
    },
  ],
  sectionRules: [{ name: "A-OWN-hevy-section-rule", treatment: "notes_on_first" }],
});

const BODY_ID_CASES: CrossUserCase[] = [
  slotCase({
    route: "POST /v1/workouts",
    name: "B's routine as routineId (actor C: no live workout)",
    slot: "body.routineId",
    actor: "C",
    foreign: (w) => w.b.routine,
    req: (_w, id) => ({ method: "POST", url: "/v1/workouts", body: { clientGeneratedId: C_START_KEY, startedAt: "2026-11-01T10:00:00Z", routineId: id } }),
    expect: 404,
    control: (w) => ({
      method: "POST",
      url: "/v1/workouts",
      body: { clientGeneratedId: uuidv7(), startedAt: "2026-11-01T10:00:00Z", routineId: w.c.routineId },
      expectStatus: 201,
    }),
    cleanup: deleteCsLiveWorkout,
  }),
  slotCase({
    route: "POST /v1/workouts/:id/exercises",
    name: "B's custom exercise as exerciseId on A's workout",
    slot: "body.exerciseId",
    foreign: (w) => w.b.customExercise,
    req: (w, id) => ({ method: "POST", url: `/v1/workouts/${w.a.liveWorkout}/exercises`, body: { exerciseId: id } }),
    expect: 404,
    control: (w) => ({ method: "POST", url: `/v1/workouts/${w.a.liveWorkout}/exercises`, body: { exerciseId: w.a.customExercise }, expectStatus: 201 }),
  }),
  slotCase({
    route: "PATCH /v1/workout-exercises/:id",
    name: "B's section as sectionId on A's workout exercise",
    slot: "body.sectionId",
    foreign: (w) => w.b.liveSection,
    req: (w, id) => ({ method: "PATCH", url: `/v1/workout-exercises/${w.a.liveWorkoutExercise}`, body: { sectionId: id } }),
    expect: 404,
    control: (w) => ({
      method: "PATCH",
      url: `/v1/workout-exercises/${w.a.liveWorkoutExercise}`,
      body: { sectionId: w.a.liveSection },
      expectStatus: 200,
      expectId: w.a.liveSection,
    }),
  }),
  slotCase({
    route: "POST /v1/routines",
    name: "B's custom exercise in an item",
    slot: "body.items[].exerciseId",
    foreign: (w) => w.b.customExercise,
    req: (_w, id) => ({ method: "POST", url: "/v1/routines", body: routineBody(id, "Made by A") }),
    expect: 422,
    control: (w) => ({ method: "POST", url: "/v1/routines", body: routineBody(w.a.customExercise, `A-OWN-routine-${uuidv7()}`), expectStatus: 201 }),
  }),
  slotCase({
    route: "PUT /v1/routines/:id",
    name: "B's custom exercise in an item of A's routine",
    slot: "body.items[].exerciseId",
    foreign: (w) => w.b.customExercise,
    req: (w, id) => ({ method: "PUT", url: `/v1/routines/${w.a.routine}`, body: routineBody(id, "Replaced by A") }),
    expect: 422,
    disposable: newRoutine,
    control: (w, scratch) => ({
      method: "PUT",
      url: `/v1/routines/${scratch!}`,
      body: routineBody(w.a.customExercise, `A-OWN-routine-${uuidv7()}`),
      expectStatus: 200,
      expectId: scratch!,
    }),
  }),
  slotCase({
    route: "GET /v1/personal-records",
    name: "B's custom exercise as the exerciseId filter",
    slot: "query.exerciseId",
    foreign: (w) => w.b.customExercise,
    req: (_w, id) => ({ method: "GET", url: `/v1/personal-records?exerciseId=${id}` }),
    expect: 200,
    control: (w) => ({ method: "GET", url: `/v1/personal-records?exerciseId=${w.a.customExercise}`, expectStatus: 200, expectId: w.a.customExercise }),
  }),
  slotCase({
    route: "GET /v1/personal-records",
    name: "B's workout as the workoutId filter",
    slot: "query.workoutId",
    foreign: (w) => w.b.finishedWorkout,
    req: (_w, id) => ({ method: "GET", url: `/v1/personal-records?workoutId=${id}` }),
    expect: 200,
    control: (w) => ({ method: "GET", url: `/v1/personal-records?workoutId=${w.a.finishedWorkout}`, expectStatus: 200, expectId: w.a.finishedWorkout }),
  }),
  slotCase({
    route: "PUT /v1/hevy/mapping",
    name: "B's custom exercise in a pair",
    slot: "body.pairs[].exerciseId",
    foreign: (w) => w.b.customExercise,
    req: (_w, id) => ({ method: "PUT", url: "/v1/hevy/mapping", body: aMapping(id) }),
    expect: 422,
    control: (w) => ({ method: "PUT", url: "/v1/hevy/mapping", body: aMapping(w.a.customExercise), expectStatus: 200, expectId: w.a.customExercise }),
  }),
  slotCase({
    route: "PATCH /v1/hevy/mapping",
    name: "B's custom exercise in an upsert",
    slot: "body.upsert[].exerciseId",
    foreign: (w) => w.b.customExercise,
    req: (_w, id) => ({ method: "PATCH", url: "/v1/hevy/mapping", body: { upsert: aMapping(id).pairs } }),
    expect: 422,
    control: (w) => ({
      method: "PATCH",
      url: "/v1/hevy/mapping",
      body: { upsert: aMapping(w.a.customExercise).pairs },
      expectStatus: 200,
      expectId: w.a.customExercise,
    }),
  }),
];

// ---------------------------------------------------------------------------
// Spec §5 — collections (rows 4, 6–8, 16, 17, 34, 40–43), AC13
// ---------------------------------------------------------------------------

interface CollectionSpec {
  route: RouteKey;
  name: string;
  actor?: Actor;
  url: (w: World, scratch?: string) => string;
  expect?: number;
  disposable?: CrossUserCase["disposable"];
  check?: CrossUserCase["check"];
  control: (w: World, scratch?: string) => ControlReq;
  controlActor?: "A" | "C";
}

function collection(s: CollectionSpec): CrossUserCase {
  return {
    route: s.route,
    name: s.name,
    covers: [],
    kind: "collection",
    expect: { status: s.expect ?? 200 },
    actor: s.actor ?? "A",
    call: (w, scratch) => ({ method: "GET", url: s.url(w, scratch) }),
    control: s.control,
    ...(s.controlActor ? { controlActor: s.controlActor } : {}),
    ...(s.disposable ? { disposable: s.disposable } : {}),
    ...(s.check ? { check: s.check } : {}),
  };
}

/** Fails if the body holds any of the given ids (the leak scan checks every id at the end; this names the case). */
function holdsNone(body: string, ids: readonly string[], what: string) {
  for (const id of ids) if (body.includes(id)) throw new Error(`${what} holds ${id}`);
}

const json = (res: CaseResponse) => JSON.parse(res.body) as Record<string, unknown>;

/** A `v1.` history cursor at `(startedAtText, id)` (Spec 07.1 §6.2). */
const workoutCursor = (startedAtText: string, id: string) => `v1.${Buffer.from(JSON.stringify({ s: startedAtText, i: id })).toString("base64url")}`;

const COLLECTION_CASES: CrossUserCase[] = [
  collection({
    route: "GET /v1/account/export",
    name: "A's export holds none of B's data",
    url: () => "/v1/account/export",
    check: (w, res) => holdsNone(res.body, w.b.allIds, "A's export"),
    control: (w) => ({ method: "GET", url: "/v1/account/export", expectStatus: 200, expectId: w.a.finishedWorkout }),
  }),
  collection({
    route: "GET /v1/exercises",
    name: "the full list leaves out B's custom exercises, retired included",
    url: () => "/v1/exercises",
    check: (w, res) => holdsNone(res.body, [w.b.customExercise, w.b.retiredExercise], "the exercise list"),
    control: (w) => ({ method: "GET", url: "/v1/exercises", expectStatus: 200, expectId: w.a.customExercise }),
  }),
  collection({
    route: "GET /v1/exercises",
    name: "a since delta leaves out a custom exercise B created and retired after A's token",
    disposable: async (w, api) => {
      const full = await api.must("A", { method: "GET", url: "/v1/exercises" }, 200);
      const name = "B-SECRET-delta-exercise-1";
      const created = await api.must("B", { method: "POST", url: "/v1/exercises", body: { name, modality: "weight_reps" } }, 201);
      await api.must("B", { method: "DELETE", url: `/v1/exercises/${created.id}` }, 204);
      w.b.markers.push(name);
      w.b.allIds.push(created.id);
      // A does the same, so the control proves the delta does carry the caller's own retired row.
      const own = await api.must("A", { method: "POST", url: "/v1/exercises", body: { name: `A-OWN-delta-${uuidv7()}`, modality: "weight_reps" } }, 201);
      await api.must("A", { method: "DELETE", url: `/v1/exercises/${own.id}` }, 204);
      return `${String(full.syncToken)} ${own.id}`;
    },
    url: (_w, scratch) => `/v1/exercises?since=${encodeURIComponent(scratch!.split(" ")[0]!)}`,
    check: (w, res) => holdsNone(res.body, w.b.allIds, "the exercise delta"),
    control: (_w, scratch) => ({
      method: "GET",
      url: `/v1/exercises?since=${encodeURIComponent(scratch!.split(" ")[0]!)}`,
      expectStatus: 200,
      expectId: scratch!.split(" ")[1]!,
    }),
  }),
  collection({
    route: "GET /v1/exercises/usage",
    name: "a built-in exercise only B logged is absent",
    url: () => "/v1/exercises/usage",
    check: (w, res) => holdsNone(res.body, [w.globalOnlyB], "A's usage"),
    control: (w) => ({ method: "GET", url: "/v1/exercises/usage", expectStatus: 200, expectId: w.a.customExercise }),
  }),
  collection({
    route: "GET /v1/exercises/:id/routines",
    name: "a built-in exercise only B's routine uses answers an empty list",
    url: (w) => `/v1/exercises/${w.globalOnlyB}/routines`,
    check: (_w, res) => {
      if ((json(res).routines as unknown[]).length !== 0) throw new Error(`expected no routines: ${res.body}`);
    },
    control: (w) => ({ method: "GET", url: `/v1/exercises/${w.globalExercise}/routines`, expectStatus: 200, expectId: w.a.routine }),
  }),
  collection({
    route: "GET /v1/progress/exercises/:id",
    name: "a built-in exercise only B logged answers no points",
    url: (w) => `/v1/progress/exercises/${w.globalOnlyB}`,
    check: (_w, res) => {
      if ((json(res).points as unknown[]).length !== 0) throw new Error(`expected no points: ${res.body}`);
    },
    control: (w) => ({ method: "GET", url: `/v1/progress/exercises/${w.globalExercise}`, expectStatus: 200 }),
  }),
  collection({
    route: "GET /v1/workouts",
    name: "the history list holds only A's workouts",
    url: () => "/v1/workouts",
    check: (w, res) => holdsNone(res.body, w.b.allIds, "A's history"),
    control: (w) => ({ method: "GET", url: "/v1/workouts", expectStatus: 200, expectId: w.a.finishedWorkout }),
  }),
  collection({
    route: "GET /v1/workouts",
    name: "a cursor at B's workout reads the same page as a cursor at a fresh id",
    disposable: async (w, api) => {
      const rows = await api.rows<{ s: string }>(
        `SELECT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS s FROM "workout" WHERE id = $1::uuid`,
        w.b.finishedWorkout,
      );
      return rows[0]!.s;
    },
    url: (w, s) => `/v1/workouts?cursor=${workoutCursor(s!, w.b.finishedWorkout)}`,
    check: async (w, res, api) => {
      const s = (await api.rows<{ s: string }>(
        `SELECT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS s FROM "workout" WHERE id = $1::uuid`,
        w.b.finishedWorkout,
      ))[0]!.s;
      const fresh = await api.call("A", { method: "GET", url: `/v1/workouts?cursor=${workoutCursor(s, uuidv7())}` });
      if (fresh.status !== res.status || fresh.body !== res.body) {
        throw new Error(`a cursor at B's workout and one at a fresh id read different pages:\n${res.body}\n${fresh.body}`);
      }
    },
    control: (w) => ({ method: "GET", url: "/v1/workouts", expectStatus: 200, expectId: w.a.finishedWorkout }),
  }),
  collection({
    route: "GET /v1/workouts/active",
    name: "C has no live workout while B has one",
    actor: "C",
    url: () => "/v1/workouts/active",
    expect: 404,
    control: (w) => ({ method: "GET", url: "/v1/workouts/active", expectStatus: 200, expectId: w.a.liveWorkout }),
    controlActor: "A",
  }),
  collection({
    route: "GET /v1/routines",
    name: "the routine list holds only A's routines, one-offs included",
    url: () => "/v1/routines",
    check: (w, res) => {
      holdsNone(res.body, [w.b.routine, w.b.oneOffRoutine], "A's routines");
      const own = (json(res).routines as { id: string; oneOffUntil: string | null }[]).find((r) => r.id === w.a.oneOffRoutine);
      if (own?.oneOffUntil == null) throw new Error(`A's one-off is missing or no longer a one-off: ${res.body}`);
    },
    control: (w) => ({ method: "GET", url: "/v1/routines", expectStatus: 200, expectId: w.a.oneOffRoutine }),
  }),
  collection({
    route: "GET /v1/personal-records",
    name: "unfiltered, A's records only",
    url: () => "/v1/personal-records",
    check: (w, res) => holdsNone(res.body, w.b.allIds, "A's records"),
    control: (w) => ({ method: "GET", url: "/v1/personal-records", expectStatus: 200, expectId: w.a.finishedWorkout }),
  }),
  collection({
    route: "GET /v1/personal-records",
    name: "filtered on a built-in exercise only B has records on",
    url: (w) => `/v1/personal-records?exerciseId=${w.globalOnlyB}`,
    check: (_w, res) => {
      if ((json(res).records as unknown[]).length !== 0) throw new Error(`expected no records: ${res.body}`);
    },
    control: (w) => ({ method: "GET", url: `/v1/personal-records?exerciseId=${w.globalExercise}`, expectStatus: 200, expectId: w.globalExercise }),
  }),
  collection({
    route: "GET /v1/hevy/status",
    name: "the counts are A's",
    url: () => "/v1/hevy/status",
    check: async (w, res, api) => {
      const [own] = await api.rows<{ pairs: number; links: number }>(
        `SELECT (SELECT count(*)::int FROM "hevy_exercise_pair" WHERE user_id = $1::uuid) AS pairs,
                (SELECT count(*)::int FROM "hevy_link" WHERE user_id = $1::uuid AND hevy_workout_id IS NOT NULL) AS links`,
        w.a.userId,
      );
      const body = json(res);
      if (body.pairCount !== own!.pairs || body.linkCount !== own!.links) {
        throw new Error(`status ${res.body} does not match A's ${own!.pairs} pairs and ${own!.links} links`);
      }
    },
    control: () => ({ method: "GET", url: "/v1/hevy/status", expectStatus: 200 }),
  }),
  collection({
    route: "GET /v1/hevy/mapping",
    name: "the pairs and section rules are A's",
    url: () => "/v1/hevy/mapping",
    check: (_w, res) => {
      if (res.body.includes("T-CROSS-B-ONLY")) throw new Error(`A's mapping holds B's pair: ${res.body}`);
      if (!res.body.includes("A-OWN-hevy-section-rule")) throw new Error(`A's mapping lacks A's section rule: ${res.body}`);
    },
    control: (w) => ({ method: "GET", url: "/v1/hevy/mapping", expectStatus: 200, expectId: w.a.customExercise }),
  }),
];

// ---------------------------------------------------------------------------
// Spec §5 — key collisions (AC14) and writes with no foreign id (rows 5, 9, 50, 51)
// ---------------------------------------------------------------------------

/** The new row is A's: its id is none of B's. */
const newRowIsActors = (w: World, res: CaseResponse, what: string) => {
  const id = json(res).id as string;
  if (w.b.allIds.includes(id)) throw new Error(`${what} replayed B's row ${id}`);
};

interface ImportEntry {
  hevyWorkoutId: string;
  startTime: string;
  endTime: string;
  title: string;
}

const importBody = (dryRun: boolean, entries: readonly ImportEntry[]) => ({
  dryRun,
  workouts: entries.map((e) => ({
    hevyWorkoutId: e.hevyWorkoutId,
    title: e.title,
    description: null,
    startTime: e.startTime,
    endTime: e.endTime,
    tzOffsetMinutes: 0,
    exercises: [
      {
        exerciseTemplateId: "T-CROSS-SHARED",
        notes: null,
        supersetId: null,
        sets: [{ type: "normal", weightKg: 60, reps: 5, distanceMeters: null, durationSeconds: null, rpe: null, customMetric: null }],
      },
    ],
  })),
});

/**
 * Spec §5 row 50. Each entry is something B holds; for A each must read as A's own state:
 * - the shared Hevy id: A imported it too, so it is A's `already_imported`;
 * - the Hevy id of B's sent link: A holds no link for it, so it is a new workout (`create`), never B's link;
 * - B's unlinked workout's day and title: A has no workout then, so `create`, never a duplicate of B's.
 */
const rowFiftyImport = (dryRun: boolean): { entries: ImportEntry[]; outcomes: string[] } => ({
  entries: [
    { hevyWorkoutId: "hevy-cross-shared-1", startTime: "2026-09-10T10:00:00Z", endTime: "2026-09-10T11:00:00Z", title: "Imported push" },
    { hevyWorkoutId: "hevy-sent-B", startTime: "2026-08-25T09:00:00Z", endTime: "2026-08-25T10:00:00Z", title: `Cross-user sent id ${dryRun ? "dry" : "run"}` },
    { hevyWorkoutId: `hevy-cross-new-${uuidv7()}`, ...B_ONLY_DAY },
  ],
  outcomes: ["already_imported", "create", "create"],
});

/** Every workout id an import result names is A's (or none), and each outcome is the one A's own state gives. */
const importAnswersFromA = (outcomes: readonly string[]) => async (w: World, res: CaseResponse, api: CaseApi) => {
  const results = json(res).results as { outcome: string; workoutId: string | null; matchedWorkoutId: string | null }[];
  const got = results.map((r) => r.outcome);
  if (JSON.stringify(got) !== JSON.stringify(outcomes)) throw new Error(`import outcomes ${JSON.stringify(got)}, expected ${JSON.stringify(outcomes)}: ${res.body}`);
  const named = results.flatMap((r) => [r.workoutId, r.matchedWorkoutId]).filter((x): x is string => x !== null);
  for (const id of named) {
    const owner = await api.rows<{ user_id: string }>(`SELECT user_id::text FROM "workout" WHERE id = $1::uuid`, id);
    if (owner[0]?.user_id !== w.a.userId) throw new Error(`the import names workout ${id}, which is not A's: ${res.body}`);
  }
};

interface WriteSpec {
  route: RouteKey;
  name: string;
  kind: "collision" | "write-isolation";
  actor?: Actor;
  req: (w: World) => Req;
  expect: number;
  check?: CrossUserCase["check"];
  control: (w: World) => ControlReq;
  controlActor?: "A" | "C";
  cleanup?: CrossUserCase["cleanup"];
}

function write(s: WriteSpec): CrossUserCase {
  return {
    route: s.route,
    name: s.name,
    covers: [],
    kind: s.kind,
    expect: { status: s.expect },
    actor: s.actor ?? "A",
    call: (w) => s.req(w),
    control: s.control,
    ...(s.controlActor ? { controlActor: s.controlActor } : {}),
    ...(s.check ? { check: s.check } : {}),
    ...(s.cleanup ? { cleanup: s.cleanup } : {}),
  };
}

const WRITE_CASES: CrossUserCase[] = [
  write({
    route: "POST /v1/workouts",
    name: "C starts a workout with B's clientGeneratedId and gets a new workout",
    kind: "collision",
    actor: "C",
    req: (w) => ({ method: "POST", url: "/v1/workouts", body: { clientGeneratedId: w.b.finishedWorkoutClientId, startedAt: "2026-11-01T10:00:00Z" } }),
    expect: 201,
    check: (w, res) => newRowIsActors(w, res, "the start"),
    control: () => ({ method: "GET", url: "/v1/workouts/active", expectStatus: 200 }),
    cleanup: deleteCsLiveWorkout,
  }),
  write({
    route: "POST /v1/workout-exercises/:id/sets",
    name: "A logs a set with the key B used on another workout exercise and gets a new set",
    kind: "collision",
    req: (w) => ({ method: "POST", url: `/v1/workout-exercises/${w.a.liveWorkoutExercise}/sets`, body: { clientGeneratedId: w.b.finishedSetClientId, reps: 4 } }),
    expect: 201,
    check: (w, res) => newRowIsActors(w, res, "the set create"),
    control: (w) => ({ method: "POST", url: `/v1/workout-exercises/${w.a.liveWorkoutExercise}/sets`, body: { clientGeneratedId: uuidv7(), reps: 4 }, expectStatus: 201 }),
  }),
  write({
    route: "POST /v1/routines",
    name: "A creates a routine with a name only B used",
    kind: "collision",
    req: (w) => ({ method: "POST", url: "/v1/routines", body: routineBody(w.a.customExercise, "Cross-user routine name only B used") }),
    expect: 201,
    check: (w, res) => newRowIsActors(w, res, "the routine create"),
    control: (w) => ({ method: "GET", url: "/v1/routines", expectStatus: 200, expectId: w.a.routine }),
  }),
  write({
    route: "POST /v1/exercises",
    name: "A creates an exercise with a name only B used",
    kind: "collision",
    req: () => ({ method: "POST", url: "/v1/exercises", body: { name: "Cross-user name only B used", modality: "weight_reps" } }),
    expect: 201,
    check: (w, res) => newRowIsActors(w, res, "the exercise create"),
    control: () => ({ method: "POST", url: "/v1/exercises", body: { name: `A-OWN-${uuidv7()}`, modality: "weight_reps" }, expectStatus: 201 }),
  }),
  write({
    route: "PATCH /v1/hevy/mapping",
    name: "A upserts a pair for a Hevy template B also holds; only A's pair changes",
    kind: "collision",
    req: (w) => ({ method: "PATCH", url: "/v1/hevy/mapping", body: { upsert: [{ ...aMapping(w.a.customExercise).pairs[0]!, hevyTemplateId: "T-CROSS-B-ONLY", exportAs: false }] } }),
    expect: 200,
    check: (w, res) => {
      if (!res.body.includes("T-CROSS-B-ONLY")) throw new Error(`A's mapping lacks the new pair: ${res.body}`);
      holdsNone(res.body, [w.globalOnlyB], "A's mapping");
    },
    control: () => ({ method: "PATCH", url: "/v1/hevy/mapping", body: { remove: ["T-CROSS-B-ONLY"] }, expectStatus: 200 }),
  }),
  write({
    route: "PATCH /v1/hevy/mapping",
    name: "A removes a Hevy template only B holds; nothing of B's changes",
    kind: "write-isolation",
    req: () => ({ method: "PATCH", url: "/v1/hevy/mapping", body: { remove: ["T-CROSS-B-ONLY"] } }),
    expect: 200,
    control: (w) => ({ method: "GET", url: "/v1/hevy/mapping", expectStatus: 200, expectId: w.a.customExercise }),
  }),
  write({
    route: "PUT /v1/hevy/mapping",
    name: "A's whole mapping names a Hevy template B also holds; B's pairs are unchanged",
    kind: "collision",
    req: (w) => ({ method: "PUT", url: "/v1/hevy/mapping", body: aMapping(w.a.customExercise) }),
    expect: 200,
    control: (w) => ({ method: "GET", url: "/v1/hevy/mapping", expectStatus: 200, expectId: w.a.customExercise }),
  }),
  write({
    route: "POST /v1/hevy/import/workouts",
    name: "a dry run of B's Hevy workout id and day matches only A's rows",
    kind: "write-isolation",
    req: () => ({ method: "POST", url: "/v1/hevy/import/workouts", body: importBody(true, rowFiftyImport(true).entries) }),
    expect: 200,
    check: importAnswersFromA(rowFiftyImport(true).outcomes),
    control: () => ({
      method: "POST",
      url: "/v1/hevy/import/workouts",
      body: importBody(true, [{ hevyWorkoutId: `hevy-cross-new-${uuidv7()}`, startTime: "2026-08-01T09:00:00Z", endTime: "2026-08-01T10:00:00Z", title: "A-OWN-import" }]),
      expectStatus: 200,
    }),
  }),
  write({
    route: "POST /v1/hevy/import/workouts",
    name: "a real run of B's Hevy workout id and day links only A's rows",
    kind: "write-isolation",
    req: () => ({ method: "POST", url: "/v1/hevy/import/workouts", body: importBody(false, rowFiftyImport(false).entries) }),
    expect: 200,
    check: importAnswersFromA(rowFiftyImport(false).outcomes),
    control: (w) => ({ method: "GET", url: `/v1/workouts/${w.a.importedWorkout}`, expectStatus: 200, expectId: w.a.importedWorkout }),
  }),
  write({
    route: "POST /v1/hevy/import/finish",
    name: "A's records recompute leaves B's records and Hevy account alone",
    kind: "write-isolation",
    req: () => ({ method: "POST", url: "/v1/hevy/import/finish" }),
    expect: 200,
    control: () => ({ method: "GET", url: "/v1/hevy/status", expectStatus: 200 }),
  }),
  // Last: C's account is gone after this, and every later call as C would be 403.
  write({
    route: "DELETE /v1/account",
    name: "C deletes its own account; A and B are unchanged",
    kind: "write-isolation",
    actor: "C",
    req: () => ({ method: "DELETE", url: "/v1/account" }),
    expect: 202,
    check: async (w, _res, api) => {
      const [a] = await api.rows<{ deleted: boolean }>(`SELECT deleted_at IS NOT NULL AS deleted FROM "user" WHERE id = $1::uuid`, w.a.userId);
      if (a?.deleted !== false) throw new Error("A's account was marked deleted");
    },
    control: () => ({ method: "GET", url: "/v1/me", expectStatus: 403 }),
  }),
];

export const CASES: CrossUserCase[] = [...PATH_ID_CASES, ...BODY_ID_CASES, ...COLLECTION_CASES, ...WRITE_CASES];
