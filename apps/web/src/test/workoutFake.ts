import { http, HttpResponse, type RequestHandler } from "msw";
import {
  AddWorkoutExerciseSchema,
  CreateSetSchema,
  CreateWorkoutSchema,
  SetEntrySchema,
  UpdateSetSchema,
  UpdateWorkoutExerciseSchema,
  UpdateWorkoutSchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  forbiddenMeasuresFor,
  requiredMeasuresFor,
  toCanonicalMeters,
  type Exercise,
  type MeasureName,
  type SetEntry,
  type WorkoutDetail,
} from "@sin/core";
import { API_BASE_URL } from "./catalogHarness";

/**
 * A stateful, in-memory stand-in for the Spec 05.0 / 05.1 workout API, just rich enough to be a real
 * conversation partner for component tests (Spec 06.1 §10): one active workout, dense positions,
 * appended set numbers, the strict `isComplete` gate (05.1 D14), `clientGeneratedId` replay (D15) and
 * the finish rule. Every response is built through the `@sin/core` schemas and every request body is
 * parsed with the core request schemas, so the fake cannot drift into accepting a shape the real API
 * rejects. **Risk, stated:** a hand-written fake can still drift on behaviour; Spec 06.3 runs the main
 * flows against the real API.
 */

const BASE = `${API_BASE_URL}/v1`;
const PROBLEM_BASE = "https://strengthinnumbers.app/problems/";

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

export interface FailMatch {
  method: string;
  path: RegExp;
}

export interface WorkoutFake {
  handlers: RequestHandler[];
  state: { active: WorkoutDetail | null; finished: Map<string, WorkoutDetail> };
  /** Every request seen, in order (including ones answered by `failNext`). */
  requests: RecordedRequest[];
  /** Answer the next `times` requests matching `match` with `response()` instead of the normal handler. */
  failNext(match: FailMatch, response: () => Response, times?: number): void;
  /** While true, every workout request fails at the network (`HttpResponse.error()`) and is not recorded (Spec 06.2). */
  setOffline(offline: boolean): void;
  /** Apply the next request matching `match` normally, then fail its response at the network: a lost response. */
  loseNextResponse(match: FailMatch): void;
}

export interface WorkoutFakeOptions {
  active?: WorkoutDetail | null;
  finished?: WorkoutDetail[];
  /** The catalog the add-exercise endpoint resolves ids against. */
  catalog?: Exercise[];
}

export function problemResponse(
  status: number,
  slug: string,
  extra: { errors?: { path: string; message: string }[] } = {},
): Response {
  return new HttpResponse(
    JSON.stringify({
      type: slug === "about:blank" ? slug : `${PROBLEM_BASE}${slug}`,
      title: slug,
      status,
      detail: "Test problem",
      instance: "req-fake",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

const notFound = () => problemResponse(404, "not-found");
const finishedConflict = () => problemResponse(409, "workout-finished");
const validation = (errors: { path: string; message: string }[]) => problemResponse(422, "validation-error", { errors });

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

// The core response schemas are non-strict objects, so parsing a detail as a `Workout` strips `exercises`.
const workoutOf = (detail: WorkoutDetail) => WorkoutSchema.parse(detail);

export function createWorkoutFake(options: WorkoutFakeOptions = {}): WorkoutFake {
  const state = {
    active: options.active ?? null,
    finished: new Map<string, WorkoutDetail>((options.finished ?? []).map((w) => [w.id, w])),
  };
  const catalog = options.catalog ?? [];
  const requests: RecordedRequest[] = [];
  const failures: { match: FailMatch; response: () => Response; remaining: number }[] = [];
  const losses: FailMatch[] = [];
  let offline = false;

  type Located =
    | { kind: "active"; detail: WorkoutDetail }
    | { kind: "finished"; detail: WorkoutDetail }
    | null;
  const locateWorkout = (id: string): Located => {
    if (state.active?.id === id) return { kind: "active", detail: state.active };
    const f = state.finished.get(id);
    return f ? { kind: "finished", detail: f } : null;
  };
  const locateExercise = (id: string) => {
    for (const detail of [state.active, ...state.finished.values()]) {
      const exercise = detail?.exercises.find((e) => e.id === id);
      if (detail && exercise) return { detail, exercise, finished: detail.endedAt !== null };
    }
    return null;
  };
  const locateSet = (id: string) => {
    for (const detail of [state.active, ...state.finished.values()]) {
      for (const exercise of detail?.exercises ?? []) {
        const set = exercise.sets.find((s) => s.id === id);
        if (detail && set) return { detail, exercise, set, finished: detail.endedAt !== null };
      }
    }
    return null;
  };

  function handle(
    method: "get" | "post" | "patch" | "delete",
    path: string,
    resolve: (ctx: { params: Record<string, string>; body: unknown }) => Response | Promise<Response>,
  ): RequestHandler {
    return http[method](`${BASE}${path}`, async ({ request, params }) => {
      if (offline) return HttpResponse.error();
      const url = new URL(request.url);
      const text = await request.clone().text();
      const body: unknown = text === "" ? undefined : JSON.parse(text);
      requests.push({ method: request.method, path: url.pathname, body });
      const failure = failures.find(
        (f) => f.remaining > 0 && f.match.method === request.method && f.match.path.test(url.pathname),
      );
      if (failure) {
        failure.remaining -= 1;
        return failure.response();
      }
      const response = await resolve({ params: params as Record<string, string>, body });
      const loss = losses.findIndex((m) => m.method === request.method && m.path.test(url.pathname));
      if (loss >= 0) {
        losses.splice(loss, 1);
        return HttpResponse.error();
      }
      return response;
    });
  }

  const parseBody = <T,>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, body: unknown) => {
    const parsed = schema.safeParse(body);
    if (parsed.success) return { ok: true as const, data: parsed.data };
    return {
      ok: false as const,
      response: validation(parsed.error.issues.map((i) => ({ path: i.path.join(".") || "body", message: i.message }))),
    };
  };

  function setErrors(modality: Parameters<typeof requiredMeasuresFor>[0], merged: Record<string, unknown>, isComplete: boolean) {
    const errors: { path: string; message: string }[] = [];
    for (const m of forbiddenMeasuresFor(modality)) {
      if (merged[m] !== null && merged[m] !== undefined) errors.push({ path: m, message: "Not allowed for this exercise" });
    }
    if (isComplete) {
      for (const m of requiredMeasuresFor(modality)) {
        if (merged[m] === null || merged[m] === undefined) errors.push({ path: m, message: "Required" });
      }
    }
    if (merged["weight"] != null && merged["weightUnit"] == null) errors.push({ path: "weightUnit", message: "Required with weight" });
    if (merged["distance"] != null && merged["distanceUnit"] == null) errors.push({ path: "distanceUnit", message: "Required with distance" });
    return errors;
  }

  function buildSet(base: Partial<SetEntry> & { workoutExerciseId: string; setNumber: number }, merged: Record<string, unknown>) {
    const weight = (merged["weight"] as number | null | undefined) ?? null;
    const weightUnit = (merged["weightUnit"] as "kg" | "lb" | null | undefined) ?? null;
    const distance = (merged["distance"] as number | null | undefined) ?? null;
    const distanceUnit = (merged["distanceUnit"] as "m" | "km" | "mi" | null | undefined) ?? null;
    return SetEntrySchema.parse({
      id: base.id ?? uuid(),
      workoutExerciseId: base.workoutExerciseId,
      clientGeneratedId: base.clientGeneratedId ?? null,
      setNumber: base.setNumber,
      setType: merged["setType"] ?? "working",
      reps: merged["reps"] ?? null,
      weight,
      weightUnit,
      weightKg: weight === null ? null : weightUnit === "lb" ? weight * 0.45359237 : weight,
      distance,
      distanceUnit,
      distanceM: distance === null || distanceUnit === null ? null : toCanonicalMeters(distance, distanceUnit),
      durationS: merged["durationS"] ?? null,
      rpe: merged["rpe"] ?? null,
      isComplete: merged["isComplete"] ?? false,
      completedAt: merged["isComplete"] ? (base.completedAt ?? now()) : null,
      createdAt: base.createdAt ?? now(),
      updatedAt: now(),
    });
  }

  const handlers: RequestHandler[] = [
    handle("post", "/workouts", ({ body }) => {
      const parsed = parseBody(CreateWorkoutSchema, body);
      if (!parsed.ok) return parsed.response;
      const input = parsed.data;
      if (state.active) {
        if (state.active.clientGeneratedId === input.clientGeneratedId) return HttpResponse.json(workoutOf(state.active), { status: 200 });
        return problemResponse(409, "workout-in-progress-exists");
      }
      const startedAt = input.startedAt;
      const skew = Date.parse(startedAt) - Date.now();
      if (skew > 300_000 || skew < -604_800_000) return validation([{ path: "startedAt", message: "Out of range" }]);
      state.active = WorkoutDetailSchema.parse({
        id: uuid(),
        title: input.title ?? null,
        notes: input.notes ?? null,
        startedAt,
        endedAt: null,
        localDate: new Date(Date.parse(startedAt) + (input.tzOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10),
        tzOffsetMinutes: input.tzOffsetMinutes ?? 0,
        clientGeneratedId: input.clientGeneratedId,
        source: "manual",
        createdAt: now(),
        updatedAt: now(),
        exercises: [],
      });
      return HttpResponse.json(workoutOf(state.active), { status: 201 });
    }),

    // `/workouts/active` must precede `/workouts/:id`.
    handle("get", "/workouts/active", () =>
      state.active ? HttpResponse.json(WorkoutDetailSchema.parse(state.active)) : notFound(),
    ),
    handle("get", "/workouts/:id", ({ params }) => {
      const found = locateWorkout(params["id"]!);
      return found ? HttpResponse.json(WorkoutDetailSchema.parse(found.detail)) : notFound();
    }),
    handle("patch", "/workouts/:id", ({ params, body }) => {
      const found = locateWorkout(params["id"]!);
      if (!found) return notFound();
      if (found.kind === "finished") return finishedConflict();
      const parsed = parseBody(UpdateWorkoutSchema, body);
      if (!parsed.ok) return parsed.response;
      const input = parsed.data;
      const detail = found.detail;
      if (input.endedAt != null) {
        if (Date.parse(input.endedAt) < Date.parse(detail.startedAt)) return validation([{ path: "endedAt", message: "Before startedAt" }]);
        const blocked = detail.exercises.some((e) =>
          e.sets.some((s) => s.setType === "working" && requiredMeasuresFor(e.modalitySnapshot).some((m: MeasureName) => s[m] === null)),
        );
        if (blocked) return problemResponse(409, "incomplete-working-sets");
      }
      const next = WorkoutDetailSchema.parse({
        ...detail,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}),
        updatedAt: now(),
      });
      if (next.endedAt !== null) {
        state.active = null;
        state.finished.set(next.id, next);
      } else {
        state.active = next;
      }
      return HttpResponse.json(workoutOf(next));
    }),
    handle("delete", "/workouts/:id", ({ params }) => {
      const id = params["id"]!;
      if (state.active?.id === id) state.active = null;
      else if (!state.finished.delete(id)) return notFound();
      return new HttpResponse(null, { status: 204 });
    }),

    handle("post", "/workouts/:id/exercises", ({ params, body }) => {
      const found = locateWorkout(params["id"]!);
      if (!found) return notFound();
      if (found.kind === "finished") return finishedConflict();
      const parsed = parseBody(AddWorkoutExerciseSchema, body);
      if (!parsed.ok) return parsed.response;
      const exercise = catalog.find((e) => e.id === parsed.data.exerciseId);
      if (!exercise) return notFound();
      if (!exercise.isActive) return problemResponse(409, "exercise-retired");
      const detail = found.detail;
      const row = {
        id: uuid(),
        workoutId: detail.id,
        position: detail.exercises.length,
        exerciseId: exercise.id,
        exerciseNameSnapshot: exercise.name,
        modalitySnapshot: exercise.modality,
        notes: null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.active = WorkoutDetailSchema.parse({ ...detail, exercises: [...detail.exercises, { ...row, sets: [] }] });
      return HttpResponse.json(WorkoutExerciseSchema.parse(row), { status: 201 });
    }),
    handle("patch", "/workout-exercises/:id", ({ params, body }) => {
      const found = locateExercise(params["id"]!);
      if (!found) return notFound();
      if (found.finished) return finishedConflict();
      const parsed = parseBody(UpdateWorkoutExerciseSchema, body);
      if (!parsed.ok) return parsed.response;
      const { detail, exercise } = found;
      const target = parsed.data.position;
      if (target !== undefined) {
        if (target < 0 || target >= detail.exercises.length) return validation([{ path: "position", message: "Out of range" }]);
        const without = detail.exercises.filter((e) => e.id !== exercise.id);
        without.splice(target, 0, exercise);
        state.active = WorkoutDetailSchema.parse({ ...detail, exercises: without.map((e, i) => ({ ...e, position: i })) });
      }
      const moved = state.active!.exercises.find((e) => e.id === exercise.id)!;
      return HttpResponse.json(WorkoutExerciseSchema.parse(moved)); // strips `sets`
    }),
    handle("delete", "/workout-exercises/:id", ({ params }) => {
      const found = locateExercise(params["id"]!);
      if (!found) return notFound();
      if (found.finished) return finishedConflict();
      const remaining = found.detail.exercises.filter((e) => e.id !== found.exercise.id).map((e, i) => ({ ...e, position: i }));
      state.active = WorkoutDetailSchema.parse({ ...found.detail, exercises: remaining });
      return new HttpResponse(null, { status: 204 });
    }),

    handle("post", "/workout-exercises/:id/sets", ({ params, body }) => {
      const found = locateExercise(params["id"]!);
      if (!found) return notFound();
      if (found.finished) return finishedConflict();
      const parsed = parseBody(CreateSetSchema, body);
      if (!parsed.ok) return parsed.response;
      const input = parsed.data;
      const { detail, exercise } = found;
      if (input.clientGeneratedId) {
        const replay = exercise.sets.find((s) => s.clientGeneratedId === input.clientGeneratedId);
        if (replay) return HttpResponse.json(SetEntrySchema.parse(replay), { status: 200 });
      }
      const errors = setErrors(exercise.modalitySnapshot, input as Record<string, unknown>, input.isComplete === true);
      if (errors.length > 0) return validation(errors);
      const set = buildSet(
        { workoutExerciseId: exercise.id, setNumber: Math.max(0, ...exercise.sets.map((s) => s.setNumber)) + 1, clientGeneratedId: input.clientGeneratedId ?? null },
        input as Record<string, unknown>,
      );
      state.active = WorkoutDetailSchema.parse({
        ...detail,
        exercises: detail.exercises.map((e) => (e.id === exercise.id ? { ...e, sets: [...e.sets, set] } : e)),
      });
      return HttpResponse.json(set, { status: 201 });
    }),
    handle("patch", "/sets/:id", ({ params, body }) => {
      const found = locateSet(params["id"]!);
      if (!found) return notFound();
      if (found.finished) return finishedConflict();
      const parsed = parseBody(UpdateSetSchema, body);
      if (!parsed.ok) return parsed.response;
      const { detail, exercise, set } = found;
      const merged = { ...set, ...parsed.data } as Record<string, unknown>;
      const errors = setErrors(exercise.modalitySnapshot, merged, merged["isComplete"] === true);
      if (errors.length > 0) return validation(errors);
      const next = buildSet(set, merged);
      state.active = WorkoutDetailSchema.parse({
        ...detail,
        exercises: detail.exercises.map((e) => (e.id === exercise.id ? { ...e, sets: e.sets.map((s) => (s.id === set.id ? next : s)) } : e)),
      });
      return HttpResponse.json(next);
    }),
    handle("delete", "/sets/:id", ({ params }) => {
      const found = locateSet(params["id"]!);
      if (!found) return notFound();
      if (found.finished) return finishedConflict();
      const { detail, exercise, set } = found;
      state.active = WorkoutDetailSchema.parse({
        ...detail,
        exercises: detail.exercises.map((e) => (e.id === exercise.id ? { ...e, sets: e.sets.filter((s) => s.id !== set.id) } : e)),
      });
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return {
    handlers,
    state,
    requests,
    failNext(match, response, times = 1) {
      failures.push({ match, response, remaining: times });
    },
    setOffline(value) {
      offline = value;
    },
    loseNextResponse(match) {
      losses.push(match);
    },
  };
}

/** `GET /v1/exercises`, `/v1/muscle-groups` and `/v1/equipment` for the picker and catalog store. */
export function catalogHandlers(rows: Exercise[]): RequestHandler[] {
  return [
    http.get(`${BASE}/exercises`, () => HttpResponse.json({ exercises: rows, syncToken: "1.100" })),
    http.get(`${BASE}/muscle-groups`, () =>
      HttpResponse.json({ muscleGroups: [{ id: "chest", name: "Chest", displayOrder: 1 }] }),
    ),
    http.get(`${BASE}/equipment`, () =>
      HttpResponse.json({ equipment: [{ id: "barbell", name: "Barbell", displayOrder: 1 }] }),
    ),
  ];
}
