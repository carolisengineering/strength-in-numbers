import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { insertExercise, type IntegrationDb } from "../helpers.js";
import { makeCrossUserApp, type WorldActor } from "./app.js";
import { ownedIds } from "./snapshot.js";

/**
 * Spec 21.0 §6.2, AC7 — the world the cross-user cases run in.
 *
 * - **B** is the victim and **A** the actor; both get the same full data set,
 *   so every case has a B id to aim at and every positive control an A id.
 * - **C** has one routine and no live workout, for cases whose precondition is
 *   "no live workout" (starting a workout).
 *
 * Users are provisioned through the app (`GET /v1/me`, the real path) and their
 * data is created through the routes too, so the rows are the ones production
 * writes. Every string B owns carries a `B-SECRET-<kind>-<n>` marker for the
 * leak scan (AC12); Hevy ids are shared, not marked, because cases send them as A.
 */

/** The ids of one user's data set; A and B have the same shape. */
export interface Owned {
  userId: string;
  /** Active custom exercise, used in the routine and both workouts. */
  customExercise: string;
  /** Retired custom exercise. */
  retiredExercise: string;
  /** A routine with a timed section, two items and planned sets. */
  routine: string;
  routineSection: string;
  routineName: string;
  /** A one-off routine (`POST /v1/routines/:id/keep` target). */
  oneOffRoutine: string;
  /** A finished workout started from the routine: exercises, sets, a timed section with a round and a result, records. */
  finishedWorkout: string;
  finishedWorkoutClientId: string;
  finishedWorkoutExercise: string;
  finishedSet: string;
  finishedSetClientId: string;
  finishedSection: string;
  /** A live workout with one exercise, one set and one section. */
  liveWorkout: string;
  liveWorkoutExercise: string;
  liveSet: string;
  liveSection: string;
  /** A workout imported from Hevy (19.1). */
  importedWorkout: string;
  exerciseName: string;
}

export interface World {
  a: Owned;
  b: Owned & { markers: string[]; allIds: string[] };
  c: { userId: string; routineId: string };
  /** A built-in exercise both A and B log. */
  globalExercise: string;
  /** A built-in exercise only B logs and only B's routine uses. */
  globalOnlyB: string;
}

/** The Hevy ids both A and B hold (the AC14 collisions and the row 50 import). */
export const SHARED_HEVY_TEMPLATE = "T-CROSS-SHARED";
export const SHARED_HEVY_WORKOUT = "hevy-cross-shared-1";
export const IMPORT_DAY = { startTime: "2026-09-10T10:00:00Z", endTime: "2026-09-10T11:00:00Z", title: "Imported push" } as const;

/**
 * Names and a Hevy template only B holds, for the AC14 collision cases. They
 * carry no marker on purpose: A sends them and the app echoes them back to A.
 */
export const B_ONLY = {
  exerciseName: "Cross-user name only B used",
  routineName: "Cross-user routine name only B used",
  hevyTemplateId: "T-CROSS-B-ONLY",
  /**
   * A finished, unlinked workout of B's on a day A has none: a duplicate candidate only for B (§5 row 50).
   * Five days back at 09:00 UTC (a start may be at most 7 days in the past); A's workouts are 2 days back and now.
   */
  day: (() => {
    const start = new Date();
    start.setUTCHours(9, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 5);
    const end = new Date(start.getTime() + 3_600_000);
    return { startTime: start.toISOString(), endTime: end.toISOString(), title: "Cross-user B-only day" };
  })(),
} as const;

/** The fields of a response body this file reads. */
interface Json {
  id: string;
  sections?: { id: string }[];
  exercises?: { id: string }[];
  fingerprint?: string;
  results?: { workoutId?: string }[];
  [key: string]: unknown;
}

type Api = (actor: WorldActor, method: string, url: string, body?: unknown) => Promise<{ status: number; json: Json }>;

function apiFor(app: FastifyInstance, as: (a: WorldActor) => Record<string, string>): Api {
  return async (actor, method, url, body) => {
    const res = await app.inject({
      method: method as "GET",
      url,
      headers: { ...as(actor), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    const json = (res.body === "" ? {} : JSON.parse(res.body)) as Json;
    return { status: res.statusCode, json };
  };
}

/** Calls a route and fails loudly unless it answers `expect`. */
async function must(api: Api, expectStatus: number, actor: WorldActor, method: string, url: string, body?: unknown): Promise<Json> {
  const res = await api(actor, method, url, body);
  if (res.status !== expectStatus) {
    throw new Error(`world: ${actor} ${method} ${url} answered ${res.status}, expected ${expectStatus}: ${JSON.stringify(res.json)}`);
  }
  return res.json;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** One user's full data set. `mark(kind)` gives the user's string for a field. */
async function buildOwned(
  api: Api,
  actor: "A" | "B",
  userId: string,
  mark: (kind: string) => string,
  globals: { shared: string; onlyB: string | null },
): Promise<Owned> {
  const exerciseName = mark("exercise");
  const custom = await must(api, 201, actor, "POST", "/v1/exercises", { name: exerciseName, modality: "weight_reps" });
  const retired = await must(api, 201, actor, "POST", "/v1/exercises", { name: mark("retired-exercise"), modality: "weight_reps" });
  await must(api, 204, actor, "DELETE", `/v1/exercises/${retired.id}`);

  const routineName = mark("routine");
  const routine = await must(api, 201, actor, "POST", "/v1/routines", {
    name: routineName,
    notes: mark("routine-notes"),
    sections: [{ key: "main", name: mark("routine-section"), notes: mark("routine-section-notes"), timer: { format: "amrap", capSeconds: 600 } }],
    // Loose items come first, then each section's run.
    items: [
      ...(globals.onlyB ? [{ exerciseId: globals.onlyB, targetSets: 1, targetRepsLow: 3, targetRepsHigh: 3 }] : []),
      { exerciseId: custom.id, targetSets: 2, targetRepsLow: 5, targetRepsHigh: 5, notes: mark("routine-item-notes"), sectionKey: "main" },
      { exerciseId: globals.shared, targetSets: 1, targetRepsLow: 8, targetRepsHigh: 8, sectionKey: "main" },
    ],
  });
  const oneOff = await must(api, 201, actor, "POST", "/v1/routines", {
    oneOff: true,
    name: mark("one-off"),
    items: [{ exerciseId: custom.id, targetSets: 1, targetRepsLow: 5, targetRepsHigh: 5 }],
  });

  // The finished workout: started from the routine, every copied exercise logged, the timed section recorded.
  const finishedClientId = uuidv7();
  const started = await must(api, 201, actor, "POST", "/v1/workouts", {
    clientGeneratedId: finishedClientId,
    startedAt: hoursAgo(50),
    title: mark("workout-title"),
    notes: mark("workout-notes"),
    routineId: routine.id,
  });
  const detail = await must(api, 200, actor, "GET", `/v1/workouts/${started.id}`);
  let finishedSet = "";
  let finishedSetClientId = "";
  for (const we of detail.exercises as { id: string }[]) {
    const key = uuidv7();
    const set = await must(api, 201, actor, "POST", `/v1/workout-exercises/${we.id}/sets`, {
      clientGeneratedId: key,
      reps: 5,
      weight: 100,
      weightUnit: "kg",
      isComplete: true,
    });
    if (finishedSet === "") {
      finishedSet = set.id;
      finishedSetClientId = key;
    }
  }
  const section = (detail.sections as { id: string }[])[0]!;
  await must(api, 200, actor, "PUT", `/v1/workout-sections/${section.id}/round-times/1`, { seconds: 240 });
  await must(api, 200, actor, "PUT", `/v1/workout-sections/${section.id}/result`, { rounds: 3, reps: 4 });
  await must(api, 200, actor, "PATCH", `/v1/workouts/${started.id}`, { endedAt: hoursAgo(49) });

  // Hevy: a mapping with a pair and a section rule, a link on the finished workout, an imported workout.
  await must(api, 200, actor, "PUT", "/v1/hevy/mapping", {
    pairs: [
      {
        hevyTemplateId: SHARED_HEVY_TEMPLATE,
        hevyTitle: mark("hevy-title"),
        hevyType: "weight_reps",
        role: "exercise",
        exerciseId: custom.id,
        measureRule: null,
        exportAs: true,
      },
    ],
    sectionRules: [{ name: mark("hevy-section-rule"), treatment: "notes_on_first" }],
  });
  if (globals.onlyB) {
    await must(api, 200, actor, "PATCH", "/v1/hevy/mapping", {
      upsert: [
        {
          hevyTemplateId: B_ONLY.hevyTemplateId,
          hevyTitle: mark("hevy-title"),
          hevyType: "weight_reps",
          role: "exercise",
          exerciseId: globals.onlyB,
          measureRule: null,
          exportAs: true,
        },
      ],
    });
    await must(api, 201, actor, "POST", "/v1/exercises", { name: B_ONLY.exerciseName, modality: "weight_reps" });
    await must(api, 201, actor, "POST", "/v1/routines", {
      name: B_ONLY.routineName,
      items: [{ exerciseId: custom.id, targetSets: 1, targetRepsLow: 5, targetRepsHigh: 5 }],
    });
  }
  const begin = await must(api, 200, actor, "POST", `/v1/workouts/${started.id}/hevy-link`);
  await must(api, 200, actor, "PUT", `/v1/workouts/${started.id}/hevy-link`, {
    hevyWorkoutId: `hevy-sent-${actor}`,
    fingerprint: begin.fingerprint,
  });
  const imported = await must(api, 200, actor, "POST", "/v1/hevy/import/workouts", {
    dryRun: false,
    workouts: [
      {
        hevyWorkoutId: SHARED_HEVY_WORKOUT,
        title: IMPORT_DAY.title,
        description: null,
        startTime: IMPORT_DAY.startTime,
        endTime: IMPORT_DAY.endTime,
        tzOffsetMinutes: 0,
        exercises: [
          {
            exerciseTemplateId: SHARED_HEVY_TEMPLATE,
            notes: null,
            supersetId: null,
            sets: [{ type: "normal", weightKg: 60, reps: 5, distanceMeters: null, durationSeconds: null, rpe: null, customMetric: null }],
          },
        ],
      },
    ],
  });
  const importedWorkout = (imported.results as { workoutId?: string }[])[0]?.workoutId;
  if (!importedWorkout) throw new Error(`world: ${actor}'s Hevy import created no workout: ${JSON.stringify(imported)}`);

  if (globals.onlyB) {
    const day = await must(api, 201, actor, "POST", "/v1/workouts", {
      clientGeneratedId: uuidv7(),
      startedAt: B_ONLY.day.startTime,
      title: B_ONLY.day.title,
    });
    const dayWe = await must(api, 201, actor, "POST", `/v1/workouts/${day.id}/exercises`, { exerciseId: custom.id });
    await must(api, 201, actor, "POST", `/v1/workout-exercises/${dayWe.id}/sets`, { reps: 5, weight: 60, weightUnit: "kg", isComplete: true });
    await must(api, 200, actor, "PATCH", `/v1/workouts/${day.id}`, { endedAt: B_ONLY.day.endTime });
  }

  // The live workout: one exercise, one set, one added section.
  const live = await must(api, 201, actor, "POST", "/v1/workouts", { clientGeneratedId: uuidv7(), startedAt: hoursAgo(0.2) });
  const liveWe = await must(api, 201, actor, "POST", `/v1/workouts/${live.id}/exercises`, { exerciseId: custom.id });
  const liveSet = await must(api, 201, actor, "POST", `/v1/workout-exercises/${liveWe.id}/sets`, { reps: 8, weight: 50, weightUnit: "kg" });
  const liveSection = await must(api, 201, actor, "POST", `/v1/workouts/${live.id}/sections`, { name: mark("live-section") });

  return {
    userId,
    customExercise: custom.id,
    retiredExercise: retired.id,
    routine: routine.id,
    routineSection: (routine.sections as { id: string }[])[0]!.id,
    routineName,
    oneOffRoutine: oneOff.id,
    finishedWorkout: started.id,
    finishedWorkoutClientId: finishedClientId,
    finishedWorkoutExercise: (detail.exercises as { id: string }[])[0]!.id,
    finishedSet,
    finishedSetClientId,
    finishedSection: section.id,
    liveWorkout: live.id,
    liveWorkoutExercise: liveWe.id,
    liveSet: liveSet.id,
    liveSection: liveSection.id,
    importedWorkout,
    exerciseName,
  };
}

/** Builds A, B and C on `db`. The building app allow-lists A and B for Hevy; the cases' app only A (AC16). */
export async function buildWorld(db: IntegrationDb): Promise<World> {
  const boot = await makeCrossUserApp(db);
  const bootApi = apiFor(boot.app, boot.as);
  const userIds = {} as Record<WorldActor, string>;
  for (const actor of ["A", "B", "C"] as const) userIds[actor] = (await must(bootApi, 200, actor, "GET", "/v1/me")).id;
  await boot.app.close();

  const globalExercise = await insertExercise(db, { name: "Cross-user Bench Press" });
  const globalOnlyB = await insertExercise(db, { name: "Cross-user Front Squat" });

  const built = await makeCrossUserApp(db, { hevyUsers: [userIds.A, userIds.B] });
  const api = apiFor(built.app, built.as);
  try {
    const markers: string[] = [];
    let n = 0;
    const markB = (kind: string) => {
      const m = `B-SECRET-${kind}-${++n}`;
      markers.push(m);
      return m;
    };
    const markA = (kind: string) => `A-OWN-${kind}`;

    const a = await buildOwned(api, "A", userIds.A, markA, { shared: globalExercise, onlyB: null });
    const b = await buildOwned(api, "B", userIds.B, markB, { shared: globalExercise, onlyB: globalOnlyB });

    const cRoutine = await must(api, 201, "C", "POST", "/v1/routines", {
      name: "C routine",
      items: [{ exerciseId: globalExercise, targetSets: 1, targetRepsLow: 5, targetRepsHigh: 5 }],
    });

    return {
      a,
      b: { ...b, markers, allIds: await ownedIds(db, userIds.B) },
      c: { userId: userIds.C, routineId: cRoutine.id },
      globalExercise,
      globalOnlyB,
    };
  } finally {
    await built.app.close();
  }
}
