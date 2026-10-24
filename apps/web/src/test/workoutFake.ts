import { http, HttpResponse, type RequestHandler } from "msw";
import {
  AddWorkoutExerciseSchema,
  CreateExerciseSchema,
  CreateSetSchema,
  CreateWorkoutSchema,
  CreateWorkoutSectionSchema,
  ExerciseIdSchema,
  ExerciseSchema,
  PersonalRecordsResponseSchema,
  ProgressSeriesSchema,
  SetEntrySchema,
  UpdatedWorkoutSchema,
  UpdateSetSchema,
  UpdateWorkoutExerciseSchema,
  UpdateWorkoutSchema,
  UpdateWorkoutSectionSchema,
  WorkoutDetailSchema,
  WorkoutSectionSchema,
  insertIndexForSection,
  sectionForNewExercise,
  ROUTINE_SECTIONS_MAX,
  resolveRetime,
  WorkoutExerciseSchema,
  WorkoutHistoryResponseSchema,
  WorkoutSchema,
  deriveTargets,
  expandQuickLine,
  normalizePlannedSet,
  normalizeSupersetGroups,
  plannedSetViolations,
  ROUTINES_PER_USER_MAX,
  ROUTINE_ONE_OFF_DAYS,
  RoutineCreateSchema,
  RoutineSchema,
  RoutineWriteSchema,
  type Routine,
  WORKOUT_SUMMARY_NAMES_MAX,
  forbiddenMeasuresFor,
  requiredMeasuresFor,
  toCanonicalMeters,
  type Exercise,
  type MeasureName,
  type Modality,
  type PersonalRecord,
  type PlannedSet,
  type PlannedSetInput,
  type ProgressPoint,
  type SetEntry,
  type WorkoutDetail,
  type WorkoutExerciseDetail,
} from "@sin/core";
import { API_BASE_URL, USER_ID } from "./catalogHarness";

/**
 * A stateful, in-memory stand-in for the Spec 05.0 / 05.1 workout API, just rich enough to be a real
 * conversation partner for component tests (Spec 06.1 §10): one active workout, dense positions,
 * appended set numbers, the strict `isComplete` gate (05.1 D14), `clientGeneratedId` replay (D15) and
 * the finish rule. `PATCH /workout-exercises/:id` applies `position` (any in-range index, others shift),
 * `supersetGroup` (1–99 / null, stored as sent) and `notes` (Spec 10.1), and `sectionId` (Spec 09.4: placed by
 * `insertIndexForSection`, superset label cleared); a plain add joins the last section iff it was added in the
 * workout (C4); section create / update / remove follow Spec 09.4 §6.4 (cap, renumber, loosen in place). Every response is built through the `@sin/core` schemas and every request body is
 * parsed with the core request schemas, so the fake cannot drift into accepting a shape the real API
 * rejects. **Risk, stated:** a hand-written fake can still drift on behaviour; Spec 06.3 runs the main
 * flows against the real API.
 */

const BASE = `${API_BASE_URL}/v1`;
const PROBLEM_BASE = "https://strengthinnumbers.app/problems/";

export interface RecordedRequest {
  method: string;
  path: string;
  /** The query string, `?`-prefixed (`""` when none). */
  search: string;
  body: unknown;
}

export interface FailMatch {
  method: string;
  path: RegExp;
}

export interface WorkoutFake {
  handlers: RequestHandler[];
  state: {
    active: WorkoutDetail | null;
    finished: Map<string, WorkoutDetail>;
    records: PersonalRecord[];
    routines: Map<string, Routine>;
    /** The catalog (a copy of `options.catalog`); `serveExercises` creates into it. */
    catalog: Exercise[];
    /** Spec 10.5: workout id → the routine it was started from, while that workout is live. */
    links: Map<string, string>;
  };
  /** Every request seen, in order (including ones answered by `failNext`). */
  requests: RecordedRequest[];
  /** Answer the next `times` requests matching `match` with `response()` instead of the normal handler. */
  /** …and with `skip`, let the first `skip` matching requests through first (Spec 10.1: fail the k-th PATCH of a plan). */
  failNext(match: FailMatch, response: () => Response, times?: number, skip?: number): void;
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
  /** Records `GET /v1/personal-records` serves (and History rows count). */
  records?: PersonalRecord[];
  /** Returned by the finishing PATCH (`workoutId` rewritten to the finished id) and stored (Spec 08.0). */
  newRecordsOnFinish?: PersonalRecord[];
  /** Series served by `GET /v1/progress/exercises/:id`, keyed by lineage root (Spec 08.1). */
  progress?: Record<string, ProgressPoint[]>;
  /** Routines served by /v1/routines (Spec 10.0). */
  routines?: Routine[];
  /** Spec 18.0 §10: after every successful write to a finished workout, its records become `recordsFor(updated)` (07.4: recomputed in the write's transaction). */
  recordsFor?: (workout: WorkoutDetail) => PersonalRecord[];
  /**
   * Spec 10.4: the fake also answers `GET /v1/exercises` (its growing catalog) and `POST /v1/exercises`
   * (a custom row, recorded and subject to `failNext` / `loseNextResponse` / `setOffline`).
   */
  serveExercises?: boolean;
  /** Spec 10.5: the routine the seeded `active` workout was started from. */
  activeRoutineId?: string;
  /** Spec 10.5: the fake's clock for `oneOffUntil`. Default `Date.now`. */
  now?: () => number;
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

const LOAD_MODALITIES = new Set(["weight_reps", "weighted_bodyweight"]);

/** 07.1's row: the same volume rule as `setVolumeMilli` (working, load modality, reps ≥ 1, weightKg > 0). */
function summaryOf(detail: WorkoutDetail, records: readonly PersonalRecord[]) {
  let volume = 0;
  let qualifying = false;
  let workingSetCount = 0;
  for (const e of detail.exercises) {
    for (const s of e.sets) {
      if (s.setType !== "working") continue;
      workingSetCount += 1;
      if (LOAD_MODALITIES.has(e.modalitySnapshot) && (s.reps ?? 0) >= 1 && (s.weightKg ?? 0) > 0) {
        volume += (s.weightKg ?? 0) * (s.reps ?? 0);
        qualifying = true;
      }
    }
  }
  return {
    ...workoutOf(detail),
    exerciseCount: detail.exercises.length,
    exerciseNames: [...detail.exercises]
      .sort((a, b) => a.position - b.position)
      .slice(0, WORKOUT_SUMMARY_NAMES_MAX)
      .map((e) => e.exerciseNameSnapshot),
    workingSetCount,
    totalVolume: qualifying ? volume : null,
    // Spec 07.3: the served count does not include set-volume records, so a History row matches the finish summary.
    recordCount: records.filter((r) => r.workoutId === detail.id && r.recordType !== "best_set_volume").length,
  };
}

/** The fake's own history cursor: opaque to the app, read only here. */
const FAKE_CURSOR = /^fake\.(\d+)$/;

export function createWorkoutFake(options: WorkoutFakeOptions = {}): WorkoutFake {
  const state = {
    active: options.active ?? null,
    finished: new Map<string, WorkoutDetail>((options.finished ?? []).map((w) => [w.id, w])),
    records: [...(options.records ?? [])],
    routines: new Map((options.routines ?? []).map((r) => [r.id as string, r])),
    catalog: [...(options.catalog ?? [])],
    links: new Map<string, string>(
      options.active && options.activeRoutineId ? [[options.active.id, options.activeRoutineId]] : [],
    ),
  };
  const catalog = state.catalog;
  const clock = options.now ?? Date.now;
  /** Spec 09.3: a linked live workout reads the mark from its routine; otherwise the stored flag stands. */
  const detailOut = (detail: WorkoutDetail) => {
    const link = state.links.get(detail.id);
    const routineIsOneOff = link === undefined ? detail.routineIsOneOff : (state.routines.get(link)?.oneOffUntil ?? null) !== null;
    return WorkoutDetailSchema.parse({ ...detail, routineIsOneOff });
  };
  const requests: RecordedRequest[] = [];
  const failures: { match: FailMatch; response: () => Response; remaining: number; skip: number }[] = [];
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
  /** Spec 07.4: writes land on a live or a finished workout alike; store each where it lives. */
  const store = (detail: unknown) => {
    const parsed = WorkoutDetailSchema.parse(detail);
    if (parsed.endedAt === null) {
      state.active = parsed;
      return parsed;
    }
    state.finished.set(parsed.id, parsed);
    if (options.recordsFor) {
      state.records = [...state.records.filter((r) => r.workoutId !== parsed.id), ...options.recordsFor(parsed)];
    }
    return parsed;
  };
  const setCount = (detail: WorkoutDetail) => detail.exercises.reduce((n, e) => n + e.sets.length, 0);
  /** 07.4 §6.3: on a finished workout, a delete that takes the set count from ≥ 1 to 0 is refused. */
  const wouldBeEmpty = (before: WorkoutDetail, after: WorkoutDetail) =>
    before.endedAt !== null && setCount(before) >= 1 && setCount(after) === 0;
  const locateExercise = (id: string) => {
    for (const detail of [state.active, ...state.finished.values()]) {
      const exercise = detail?.exercises.find((e) => e.id === id);
      if (detail && exercise) return { detail, exercise };
    }
    return null;
  };
  const locateSet = (id: string) => {
    for (const detail of [state.active, ...state.finished.values()]) {
      for (const exercise of detail?.exercises ?? []) {
        const set = exercise.sets.find((s) => s.id === id);
        if (detail && set) return { detail, exercise, set };
      }
    }
    return null;
  };

  /** Spec 09.4 §6.2: an exercise's rank is its section's position, or -1 when loose. */
  const rankOf = (detail: WorkoutDetail, e: { sectionId: string | null }) =>
    e.sectionId === null ? -1 : (detail.sections.find((s) => s.id === e.sectionId)?.position ?? -1);
  /** Insert `row` (not in `others`) at `index` among the position-ordered `others`, positions dense. */
  const placeAt = (others: readonly WorkoutExerciseDetail[], row: WorkoutExerciseDetail, index: number) => {
    const list = [...others];
    list.splice(index, 0, row);
    return list.map((e, i) => ({ ...e, position: i }));
  };
  const byPosition = (list: readonly WorkoutExerciseDetail[]) => [...list].sort((a, b) => a.position - b.position);
  const locateSection = (id: string) => {
    for (const detail of [state.active, ...state.finished.values()]) {
      const section = detail?.sections.find((s) => s.id === id);
      if (detail && section) return { detail, section };
    }
    return null;
  };

  function handle(
    method: "get" | "post" | "put" | "patch" | "delete",
    path: string,
    resolve: (ctx: { params: Record<string, string>; body: unknown; query: URLSearchParams }) => Response | Promise<Response>,
  ): RequestHandler {
    return http[method](`${BASE}${path}`, async ({ request, params }) => {
      if (offline) return HttpResponse.error();
      const url = new URL(request.url);
      const text = await request.clone().text();
      const body: unknown = text === "" ? undefined : JSON.parse(text);
      requests.push({ method: request.method, path: url.pathname, search: url.search, body });
      const failure = failures.find(
        (f) => f.remaining > 0 && f.match.method === request.method && f.match.path.test(url.pathname),
      );
      if (failure) {
        if (failure.skip > 0) {
          failure.skip -= 1;
        } else {
          failure.remaining -= 1;
          return failure.response();
        }
      }
      const response = await resolve({ params: params as Record<string, string>, body, query: url.searchParams });
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

  /** Spec 09.3 AC3: one-offs first, newest created first; then lowercase name, then id. */
  const sortedRoutines = () =>
    [...state.routines.values()].sort((x, y) => {
      const xo = x.oneOffUntil !== null;
      const yo = y.oneOffUntil !== null;
      if (xo !== yo) return xo ? -1 : 1;
      if (xo) {
        const byCreated = Date.parse(y.createdAt) - Date.parse(x.createdAt);
        if (byCreated !== 0) return byCreated;
      }
      const a = x.name.toLowerCase();
      const b = y.name.toLowerCase();
      return a !== b ? (a < b ? -1 : 1) : x.id < y.id ? -1 : 1;
    });

  /** Spec 09.1's `resolveItemPlan`, rebuilt from the same core helpers: rows win; the legacy quick line expands; a rep range with no set count stays rowless (O1). */
  function resolveItem(item: { sets?: readonly PlannedSetInput[] | undefined; targetSets?: number | null | undefined; targetRepsLow?: number | null | undefined; targetRepsHigh?: number | null | undefined }): {
    sets: PlannedSet[];
    targetSets: number | null;
    targetRepsLow: number | null;
    targetRepsHigh: number | null;
  } {
    if (item.sets !== undefined) {
      const rows = item.sets.map(normalizePlannedSet);
      return { sets: rows, ...deriveTargets(rows) };
    }
    const rows = expandQuickLine(item);
    if (rows.length > 0) return { sets: rows, ...deriveTargets(rows) };
    return { sets: [], targetSets: null, targetRepsLow: item.targetRepsLow ?? null, targetRepsHigh: item.targetRepsHigh ?? null };
  }

  /** Spec 09 §6.2 order: schema 422 → visibility 422 → retired 409 (first offending index) → name 409. */
  function routineWrite(
    body: unknown,
    selfId: string | null,
    schema: typeof RoutineWriteSchema | typeof RoutineCreateSchema,
  ): { ok: true; routine: Routine } | { ok: false; response: Response } {
    const parsed = parseBody(schema, body);
    if (!parsed.ok) return parsed;
    const input = parsed.data;
    const oneOff = "oneOff" in input && input.oneOff === true;
    for (const [i, item] of input.items.entries()) {
      const exercise = catalog.find((e) => e.id === item.exerciseId);
      if (!exercise) return { ok: false, response: validation([{ path: `items.${i}.exerciseId`, message: "Unknown exercise" }]) };
    }
    const retiredAt = input.items.findIndex((item) => catalog.find((e) => e.id === item.exerciseId)?.isActive === false);
    if (retiredAt >= 0) {
      return { ok: false, response: problemResponse(409, "exercise-retired", { errors: [{ path: `items.${retiredAt}.exerciseId`, message: "Exercise retired" }] }) };
    }
    const violations = input.items.flatMap((item, i) => {
      const modality = catalog.find((e) => e.id === item.exerciseId)?.modality as Modality | undefined;
      if (item.sets === undefined || modality === undefined) return [];
      return plannedSetViolations(modality, item.sets).map((v) => ({ path: `items.${i}.sets.${v.row}.${v.field}`, message: v.message }));
    });
    if (violations.length > 0) return { ok: false, response: validation(violations) };
    const lower = input.name.toLowerCase();
    if ([...state.routines.values()].some((r) => r.id !== selfId && r.name.toLowerCase() === lower)) {
      return { ok: false, response: problemResponse(409, "routine-name-taken") };
    }
    const groups = normalizeSupersetGroups(input.items.map((i) => i.supersetGroup ?? null));
    const existing = selfId === null ? undefined : state.routines.get(selfId);
    const sectionRows = (input.sections ?? []).map((s, position) => ({ id: uuid(), position, name: s.name, notes: s.notes ?? null }));
    const sectionIdOfKey = new Map((input.sections ?? []).map((s, j) => [s.key, sectionRows[j]!.id]));
    const routine = RoutineSchema.parse({
      id: selfId ?? uuid(),
      name: input.name,
      notes: input.notes ?? null,
      sections: sectionRows,
      items: input.items.map((item, position) => {
        const plan = resolveItem(item);
        return {
          id: uuid(),
          position,
          exerciseId: item.exerciseId,
          targetSets: plan.targetSets,
          targetRepsLow: plan.targetRepsLow,
          targetRepsHigh: plan.targetRepsHigh,
          targetRpe: item.targetRpe ?? null,
          restSeconds: item.restSeconds ?? null,
          supersetGroup: groups[position] ?? null,
          notes: item.notes ?? null,
          sets: plan.sets,
          sectionId: item.sectionKey ? (sectionIdOfKey.get(item.sectionKey) ?? null) : null,
        };
      }),
      createdAt: existing?.createdAt ?? new Date(clock()).toISOString(),
      updatedAt: now(),
      // Spec 09.3: a create with `oneOff: true` marks it for 14 days; a PUT never changes the mark.
      oneOffUntil: existing
        ? existing.oneOffUntil
        : oneOff
          ? new Date(clock() + ROUTINE_ONE_OFF_DAYS * 86_400_000).toISOString()
          : null,
    });
    return { ok: true, routine };
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
      let routine: Routine | undefined;
      if (input.routineId !== undefined) {
        routine = state.routines.get(input.routineId);
        if (!routine) return notFound();
        const retired = routine.items.some((item) => catalog.find((e) => e.id === item.exerciseId)?.isActive === false);
        if (retired) return problemResponse(409, "exercise-retired", { errors: [{ path: "routineId", message: "Exercise retired" }] });
      }
      const workoutIdForStart = uuid();
      if (routine) state.links.set(workoutIdForStart, routine.id);
      const startSections = (routine?.sections ?? []).map((s) => ({ id: uuid(), position: s.position, name: s.name, notes: s.notes, addedInWorkout: false }));
      // Spec 09.2 §6.4: the join is on section position (each copy keeps its routine section's position).
      const startSectionOf = (routineSectionId: string | null): string | null => {
        if (routineSectionId === null) return null;
        const position = routine?.sections.find((s) => s.id === routineSectionId)?.position;
        return startSections.find((s) => s.position === position)?.id ?? null;
      };
      state.active = WorkoutDetailSchema.parse({
        id: workoutIdForStart,
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
        routineName: routine?.name ?? null,
        plannedDurationSeconds: null,
        routineNotes: routine?.notes ?? null,
        sections: startSections,
        routineIsOneOff: false,
        exercises: (routine?.items ?? []).map((item, position) => {
          const exercise = catalog.find((e) => e.id === item.exerciseId);
          return {
            id: uuid(),
            workoutId: workoutIdForStart,
            position,
            exerciseId: item.exerciseId,
            exerciseNameSnapshot: exercise?.name ?? "Exercise",
            modalitySnapshot: exercise?.modality ?? "weight_reps",
            notes: item.notes,
            createdAt: now(),
            updatedAt: now(),
            targetSets: item.targetSets,
            targetRepsLow: item.targetRepsLow,
            targetRepsHigh: item.targetRepsHigh,
            targetRpe: item.targetRpe,
            restSeconds: item.restSeconds,
            supersetGroup: item.supersetGroup,
            // Spec 09.1: the start copies the item's planned rows.
            plannedSets: item.sets.map((s) => ({ ...s })),
            sectionId: startSectionOf(item.sectionId),
            sets: [],
          };
        }),
      });
      return HttpResponse.json(workoutOf(state.active), { status: 201 });
    }),

    // `/workouts/active` must precede `/workouts/:id`.
    handle("get", "/workouts/active", () =>
      state.active ? HttpResponse.json(detailOut(state.active)) : notFound(),
    ),
    // Spec 07.1: finished workouts, newest first, keyset-like paging with an opaque cursor.
    handle("get", "/workouts", ({ query }) => {
      const limit = Number(query.get("limit") ?? "20");
      const cursor = query.get("cursor");
      const match = cursor === null ? null : FAKE_CURSOR.exec(cursor);
      if (cursor !== null && match === null) return validation([{ path: "cursor", message: "Invalid cursor" }]);
      const offset = match ? Number(match[1]) : 0;
      const rows = [...state.finished.values()].sort(
        (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.id < b.id ? 1 : -1),
      );
      const page = rows.slice(offset, offset + limit);
      const next = offset + limit < rows.length ? `fake.${offset + limit}` : null;
      return HttpResponse.json(
        WorkoutHistoryResponseSchema.parse({ items: page.map((d) => summaryOf(d, state.records)), next }),
      );
    }),
    // Spec 07.0: the caller's records, optionally filtered.
    handle("get", "/personal-records", ({ query }) => {
      const workoutId = query.get("workoutId");
      const exerciseId = query.get("exerciseId");
      const records = state.records.filter(
        (r) => (workoutId === null || r.workoutId === workoutId) && (exerciseId === null || r.exerciseId === exerciseId),
      );
      return HttpResponse.json(PersonalRecordsResponseSchema.parse({ records }));
    }),
    // Spec 07.2: one lineage's series; from/to inclusive on localDate; 422 malformed id, 404 unseen.
    // Spec 09 routines (Spec 10.0's screens).
    ...(options.serveExercises
      ? [
          handle("get", "/exercises", () => HttpResponse.json({ exercises: catalog, syncToken: `1.${200 + catalog.length}` })),
          handle("post", "/exercises", ({ body }) => {
            const parsed = parseBody(CreateExerciseSchema, body);
            if (!parsed.ok) return parsed.response;
            const at = now();
            const row = ExerciseSchema.parse({
              ...parsed.data,
              id: uuid(),
              catalogKey: null,
              ownerUserId: USER_ID,
              isActive: true,
              forkedFromExerciseId: null,
              createdAt: at,
              updatedAt: at,
            });
            catalog.push(row);
            return HttpResponse.json(row, { status: 201 });
          }),
        ]
      : []),
    handle("get", "/routines", () => HttpResponse.json({ routines: sortedRoutines() })),
    handle("post", "/routines", ({ body }) => {
      if (state.routines.size >= ROUTINES_PER_USER_MAX) return problemResponse(409, "routine-limit");
      const result = routineWrite(body, null, RoutineCreateSchema);
      if (!result.ok) return result.response;
      state.routines.set(result.routine.id, result.routine);
      return HttpResponse.json(result.routine, { status: 201 });
    }),
    handle("get", "/routines/:id", ({ params }) => {
      const routine = state.routines.get(params["id"]!);
      return routine ? HttpResponse.json(routine) : notFound();
    }),
    handle("put", "/routines/:id", ({ params, body }) => {
      if (!state.routines.has(params["id"]!)) return notFound();
      const result = routineWrite(body, params["id"]!, RoutineWriteSchema);
      if (!result.ok) return result.response;
      state.routines.set(result.routine.id, result.routine);
      return HttpResponse.json(result.routine);
    }),
    // Spec 09.3: Keep clears the mark; 204, no body. An ordinary routine is left as it is (AC9: same updatedAt).
    handle("post", "/routines/:id/keep", ({ params }) => {
      const routine = state.routines.get(params["id"]!);
      if (!routine) return notFound();
      if (routine.oneOffUntil !== null) {
        state.routines.set(routine.id, RoutineSchema.parse({ ...routine, oneOffUntil: null, updatedAt: now() }));
      }
      return new HttpResponse(null, { status: 204 });
    }),
    handle("delete", "/routines/:id", ({ params }) =>
      state.routines.delete(params["id"]!) ? new HttpResponse(null, { status: 204 }) : notFound(),
    ),

    handle("get", "/progress/exercises/:id", ({ params, query }) => {
      const id = params["id"]!;
      if (!ExerciseIdSchema.safeParse(id).success) return validation([{ path: "id", message: "Invalid id" }]);
      const points = options.progress?.[id];
      if (!points) return notFound();
      const from = query.get("from");
      const to = query.get("to");
      const inRange = points.filter((p) => (from === null || p.localDate >= from) && (to === null || p.localDate <= to));
      return HttpResponse.json(ProgressSeriesSchema.parse({ exerciseId: id, points: inRange }));
    }),
    handle("get", "/workouts/:id", ({ params }) => {
      const found = locateWorkout(params["id"]!);
      return found ? HttpResponse.json(detailOut(found.detail)) : notFound();
    }),
    handle("patch", "/workouts/:id", ({ params, body }) => {
      const found = locateWorkout(params["id"]!);
      if (!found) return notFound();
      const parsed = parseBody(UpdateWorkoutSchema, body);
      if (!parsed.ok) return parsed.response;
      const input = parsed.data;
      const detail = found.detail;
      if (found.kind === "finished" && input.endedAt != null) return finishedConflict();
      // Spec 18.0 §10: Change Time goes through the shared rule set, as the API does (07.4 §6.4).
      let times: Partial<Pick<WorkoutDetail, "startedAt" | "endedAt" | "tzOffsetMinutes" | "localDate" | "plannedDurationSeconds">> = {};
      if (input.startedAt !== undefined || input.durationSeconds !== undefined) {
        const retime = resolveRetime(
          {
            startedAt: new Date(detail.startedAt),
            endedAt: detail.endedAt === null ? null : new Date(detail.endedAt),
            plannedDurationS: detail.plannedDurationSeconds,
          },
          {
            ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
            ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
          },
          new Date(),
        );
        if (!retime.ok) return validation([{ path: retime.path, message: retime.message }]);
        const offset = input.tzOffsetMinutes ?? detail.tzOffsetMinutes;
        times = {
          startedAt: retime.startedAt.toISOString(),
          ...(retime.startChanged
            ? { tzOffsetMinutes: offset, localDate: new Date(retime.startedAt.getTime() + offset * 60_000).toISOString().slice(0, 10) }
            : {}),
          ...(found.kind === "finished"
            ? { endedAt: retime.endedAt!.toISOString() }
            : { plannedDurationSeconds: retime.plannedDurationS }),
        };
      }
      if (found.kind === "finished") {
        // 07.4: only a re-finish is refused; title / notes and time edits apply.
        const edited = store({
          ...detail,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...times,
          updatedAt: now(),
        });
        return HttpResponse.json(UpdatedWorkoutSchema.parse({ ...workoutOf(edited), newRecords: [] }));
      }
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
        ...times,
        // 07.4: the finish clears the plan.
        ...(input.endedAt != null ? { endedAt: input.endedAt, plannedDurationSeconds: null } : {}),
        updatedAt: now(),
      });
      if (next.endedAt !== null) {
        // Spec 09.3: the finish removes a one-off routine, or keeps it with `keepRoutine: true`; the link goes either way.
        const link = state.links.get(next.id);
        const routine = link === undefined ? undefined : state.routines.get(link);
        if (routine && routine.oneOffUntil !== null) {
          if (input.keepRoutine === true) state.routines.set(routine.id, RoutineSchema.parse({ ...routine, oneOffUntil: null, updatedAt: now() }));
          else state.routines.delete(routine.id);
        }
        state.links.delete(next.id);
        state.active = null;
        state.finished.set(next.id, { ...next, routineIsOneOff: false });
      } else {
        state.active = next;
      }
      let newRecords: PersonalRecord[] = [];
      if (next.endedAt !== null && detail.endedAt === null) {
        newRecords = (options.newRecordsOnFinish ?? []).map((r) => ({ ...r, workoutId: next.id }));
        state.records = [...state.records.filter((r) => r.workoutId !== next.id), ...newRecords];
      }
      // Spec 07.0 D12: every PATCH carries `newRecords` (`[]` unless this request finished the workout).
      return HttpResponse.json(UpdatedWorkoutSchema.parse({ ...workoutOf(next), newRecords }));
    }),
    handle("delete", "/workouts/:id", ({ params }) => {
      const id = params["id"]!;
      if (state.active?.id === id) {
        state.active = null;
        state.links.delete(id);
      } else if (!state.finished.delete(id)) return notFound();
      return new HttpResponse(null, { status: 204 });
    }),

    handle("post", "/workouts/:id/exercises", ({ params, body }) => {
      const found = locateWorkout(params["id"]!);
      if (!found) return notFound();
      const parsed = parseBody(AddWorkoutExerciseSchema, body);
      if (!parsed.ok) return parsed.response;
      const exercise = catalog.find((e) => e.id === parsed.data.exerciseId);
      if (!exercise) return notFound();
      if (!exercise.isActive) return problemResponse(409, "exercise-retired");
      const detail = found.detail;
      // Spec 09.4 §6.5 (C4): a plain add joins the last section iff it was added during the workout.
      const target = sectionForNewExercise(detail.sections);
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
        targetSets: null,
        targetRepsLow: null,
        targetRepsHigh: null,
        targetRpe: null,
        restSeconds: null,
        supersetGroup: null,
        plannedSets: [],
        sectionId: target?.id ?? null,
      };
      const others = byPosition(detail.exercises);
      const index = target ? insertIndexForSection(others.map((e) => rankOf(detail, e)), target.position) : others.length;
      const stored = store({ ...detail, exercises: placeAt(others, { ...row, sets: [] } as unknown as WorkoutExerciseDetail, index) });
      return HttpResponse.json(WorkoutExerciseSchema.parse(stored.exercises.find((e) => e.id === row.id)), { status: 201 });
    }),
    handle("patch", "/workout-exercises/:id", ({ params, body }) => {
      const found = locateExercise(params["id"]!);
      if (!found) return notFound();
      const parsed = parseBody(UpdateWorkoutExerciseSchema, body);
      if (!parsed.ok) return parsed.response;
      const { detail, exercise } = found;
      let current = detail;
      const target = parsed.data.position;
      if (target !== undefined) {
        if (target < 0 || target >= detail.exercises.length) return validation([{ path: "position", message: "Out of range" }]);
        const without = detail.exercises.filter((e) => e.id !== exercise.id);
        without.splice(target, 0, exercise);
        current = { ...current, exercises: without.map((e, i) => ({ ...e, position: i })) };
      }
      const { sectionId } = parsed.data;
      let clearGroup = false;
      if (sectionId !== undefined && sectionId !== exercise.sectionId) {
        // Spec 09.4 §6.3: the server places the move (§6.2) and drops the exercise from its superset.
        const section = sectionId === null ? null : detail.sections.find((x) => x.id === sectionId);
        if (section === undefined) return notFound();
        const others = byPosition(detail.exercises.filter((e) => e.id !== exercise.id));
        const index = insertIndexForSection(others.map((e) => rankOf(detail, e)), section === null ? -1 : section.position);
        current = { ...current, exercises: placeAt(others, { ...exercise, sectionId: section?.id ?? null }, index) };
        clearGroup = true;
      }
      const { notes } = parsed.data;
      const supersetGroup = parsed.data.supersetGroup !== undefined ? parsed.data.supersetGroup : clearGroup ? null : undefined;
      if (supersetGroup !== undefined || notes !== undefined) {
        current = {
          ...current,
          exercises: current.exercises.map((e) =>
            e.id === exercise.id
              ? { ...e, ...(supersetGroup !== undefined ? { supersetGroup } : {}), ...(notes !== undefined ? { notes } : {}) }
              : e,
          ),
        };
      }
      const moved = store(current).exercises.find((e) => e.id === exercise.id)!;
      return HttpResponse.json(WorkoutExerciseSchema.parse(moved)); // strips `sets`
    }),
    handle("delete", "/workout-exercises/:id", ({ params }) => {
      const found = locateExercise(params["id"]!);
      if (!found) return notFound();
      const remaining = found.detail.exercises.filter((e) => e.id !== found.exercise.id).map((e, i) => ({ ...e, position: i }));
      const after = { ...found.detail, exercises: remaining };
      if (wouldBeEmpty(found.detail, after)) return problemResponse(409, "workout-would-be-empty");
      store(after);
      return new HttpResponse(null, { status: 204 });
    }),

    // Spec 09.4 §6.4: a workout's own sections.
    handle("post", "/workouts/:id/sections", ({ params, body }) => {
      const found = locateWorkout(params["id"]!);
      if (!found) return notFound();
      const parsed = parseBody(CreateWorkoutSectionSchema, body);
      if (!parsed.ok) return parsed.response;
      const detail = found.detail;
      if (detail.sections.length >= ROUTINE_SECTIONS_MAX) return problemResponse(409, "workout-section-limit");
      const section = WorkoutSectionSchema.parse({
        id: uuid(),
        position: detail.sections.length,
        name: parsed.data.name,
        notes: parsed.data.notes ?? null,
        addedInWorkout: true,
      });
      store({ ...detail, sections: [...detail.sections, section] });
      return HttpResponse.json(section, { status: 201 });
    }),
    handle("patch", "/workout-sections/:id", ({ params, body }) => {
      const found = locateSection(params["id"]!);
      if (!found) return notFound();
      const parsed = parseBody(UpdateWorkoutSectionSchema, body);
      if (!parsed.ok) return parsed.response;
      const next = WorkoutSectionSchema.parse({
        ...found.section,
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      });
      store({ ...found.detail, sections: found.detail.sections.map((x) => (x.id === next.id ? next : x)) });
      return HttpResponse.json(next);
    }),
    handle("delete", "/workout-sections/:id", ({ params }) => {
      const found = locateSection(params["id"]!);
      if (!found) return notFound();
      const removed = found.section;
      store({
        ...found.detail,
        sections: found.detail.sections
          .filter((x) => x.id !== removed.id)
          .map((x) => (x.position > removed.position ? { ...x, position: x.position - 1 } : x)),
        // The FK nulls section_id; positions are untouched.
        exercises: found.detail.exercises.map((e) => (e.sectionId === removed.id ? { ...e, sectionId: null } : e)),
      });
      return new HttpResponse(null, { status: 204 });
    }),

    handle("post", "/workout-exercises/:id/sets", ({ params, body }) => {
      const found = locateExercise(params["id"]!);
      if (!found) return notFound();
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
      store({
        ...detail,
        exercises: detail.exercises.map((e) => (e.id === exercise.id ? { ...e, sets: [...e.sets, set] } : e)),
      });
      return HttpResponse.json(set, { status: 201 });
    }),
    handle("patch", "/sets/:id", ({ params, body }) => {
      const found = locateSet(params["id"]!);
      if (!found) return notFound();
      const parsed = parseBody(UpdateSetSchema, body);
      if (!parsed.ok) return parsed.response;
      const { detail, exercise, set } = found;
      const merged = { ...set, ...parsed.data } as Record<string, unknown>;
      const errors = setErrors(exercise.modalitySnapshot, merged, merged["isComplete"] === true);
      if (errors.length > 0) return validation(errors);
      const next = buildSet(set, merged);
      store({
        ...detail,
        exercises: detail.exercises.map((e) => (e.id === exercise.id ? { ...e, sets: e.sets.map((s) => (s.id === set.id ? next : s)) } : e)),
      });
      return HttpResponse.json(next);
    }),
    handle("delete", "/sets/:id", ({ params }) => {
      const found = locateSet(params["id"]!);
      if (!found) return notFound();
      const { detail, exercise, set } = found;
      const after = {
        ...detail,
        exercises: detail.exercises.map((e) => (e.id === exercise.id ? { ...e, sets: e.sets.filter((s) => s.id !== set.id) } : e)),
      };
      if (wouldBeEmpty(detail, after)) return problemResponse(409, "workout-would-be-empty");
      store(after);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return {
    handlers,
    state,
    requests,
    failNext(match, response, times = 1, skip = 0) {
      failures.push({ match, response, remaining: times, skip });
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
