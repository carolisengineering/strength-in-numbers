import type {
  CodeCount,
  HevyFolder,
  HevyImportBatch,
  HevyImportDropCode,
  HevyImportOutcome,
  HevyImportResult,
  HevyImportWorkout,
  HevyRoutine,
  HevySet,
  HevyWorkout,
} from "@sin/core";
import { http, HttpResponse } from "msw";

import { createApiClient } from "../api/client";
import { API_BASE_URL } from "./accountHarness";

/**
 * Test-only (Spec 20.1): a fake Hevy for the import's reads, as MSW handlers on Hevy's origin (the real client goes
 * through `window.fetch`, so MSW sees it). It serves the five lists with Hevy's field names, honors `page` and
 * `pageSize`, can fail on demand and can shift its workout pages mid-read. Pair it with `setInstantPacing()`.
 */

const HEVY = "https://api.hevyapp.com";

export interface HevyFakeFixture {
  templates?: readonly unknown[];
  folders?: readonly HevyFolder[];
  routines?: readonly HevyRoutine[];
  workouts?: readonly HevyWorkout[];
  /** What `GET /v1/workouts/count` answers; the workout list's length when absent. */
  count?: number;
}

export type HevyFakePath = "/v1/workouts/count" | "/v1/exercise_templates" | "/v1/routine_folders" | "/v1/routines" | "/v1/workouts";
export interface HevyFakeRequest {
  path: HevyFakePath;
  page: number | null;
  pageSize: number | null;
}

const LIST_FIELD = {
  "/v1/exercise_templates": "exercise_templates",
  "/v1/routine_folders": "routine_folders",
  "/v1/routines": "routines",
  "/v1/workouts": "workouts",
} as const;

export function fakeHevyApi(fixture: HevyFakeFixture) {
  const lists: Record<keyof typeof LIST_FIELD, unknown[]> = {
    "/v1/exercise_templates": [...(fixture.templates ?? [])],
    "/v1/routine_folders": [...(fixture.folders ?? [])],
    "/v1/routines": [...(fixture.routines ?? [])],
    "/v1/workouts": [...(fixture.workouts ?? [])],
  };
  const log: HevyFakeRequest[] = [];
  const failures = new Map<HevyFakePath, { kind: number | "network" | "garbage"; times: number }>();
  let shift: { afterPage: number; workout: HevyWorkout } | null = null;
  const holds = new Map<HevyFakePath, number>();

  /** The next `times` requests to `path` fail: an HTTP status, a network error, or a reply that fails the schema. */
  function failNext(path: HevyFakePath, kind: number | "network" | "garbage", times = 1): void {
    failures.set(path, { kind, times });
  }
  /** Once `afterPage` of the workouts has been served, `workout` is added at the front (Hevy is newest first). */
  function shiftAfterPage(afterPage: number, workout: HevyWorkout): void {
    shift = { afterPage, workout };
  }
  /** Page `page` of `path` never answers (a read caught mid-way). */
  function holdPage(path: HevyFakePath, page: number): void {
    holds.set(path, page);
  }

  async function failure(path: HevyFakePath): Promise<Response | null> {
    const f = failures.get(path);
    if (!f || f.times <= 0) return null;
    f.times -= 1;
    if (f.kind === "network") return HttpResponse.error();
    if (f.kind === "garbage") return HttpResponse.json({ nonsense: true });
    return HttpResponse.json({ error: "fake failure" }, { status: f.kind });
  }

  const count = http.get(`${HEVY}/v1/workouts/count`, async () => {
    log.push({ path: "/v1/workouts/count", page: null, pageSize: null });
    const failed = await failure("/v1/workouts/count");
    if (failed) return failed;
    return HttpResponse.json({ workout_count: fixture.count ?? lists["/v1/workouts"].length });
  });

  const list = (path: keyof typeof LIST_FIELD) =>
    http.get(`${HEVY}${path}`, async ({ request }) => {
      const params = new URL(request.url).searchParams;
      const page = Number(params.get("page"));
      const pageSize = Number(params.get("pageSize"));
      log.push({ path, page, pageSize });
      const failed = await failure(path);
      if (failed) return failed;
      if (holds.get(path) === page) await new Promise<never>(() => {});
      const rows = lists[path];
      const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
      const body = { page, page_count: pageCount, [LIST_FIELD[path]]: rows.slice((page - 1) * pageSize, page * pageSize) };
      if (path === "/v1/workouts" && shift !== null && page === shift.afterPage) {
        rows.unshift(shift.workout);
        shift = null;
      }
      return HttpResponse.json(body);
    });

  const handlers = [count, ...(Object.keys(LIST_FIELD) as (keyof typeof LIST_FIELD)[]).map(list)];
  return { handlers, log, failNext, shiftAfterPage, holdPage };
}

/** A small deterministic generator (mulberry32), so a seed always gives the same workouts. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GENERATED_TEMPLATE_IDS = ["79D0BB3A", "D04AC939", "3601968B", "C6272009", "B5D3A742"] as const;

/**
 * `n` Hevy workouts with Hevy's field names, newest first (as Hevy lists them), one a day back from 2026-10-28,
 * each with 1–3 exercises from `GENERATED_TEMPLATE_IDS` and 1–4 weight-and-reps sets.
 */
export function generateHevyWorkouts(n: number, seed = 1): HevyWorkout[] {
  const next = random(seed);
  const day = 24 * 60 * 60 * 1000;
  const newest = Date.parse("2026-10-28T17:00:00Z");
  return Array.from({ length: n }, (_, i) => {
    const start = newest - i * day;
    const exercises = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, e) => {
      const sets: HevySet[] = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, s) => ({
        index: s,
        type: "normal",
        weight_kg: 20 + Math.floor(next() * 80),
        reps: 1 + Math.floor(next() * 12),
        distance_meters: null,
        duration_seconds: null,
        rpe: null,
        custom_metric: null,
      }));
      return {
        index: e,
        title: `Exercise ${e}`,
        exercise_template_id: GENERATED_TEMPLATE_IDS[Math.floor(next() * GENERATED_TEMPLATE_IDS.length)]!,
        notes: null,
        superset_id: null,
        sets,
      };
    });
    return {
      id: `hevy-w-${seed}-${String(i).padStart(5, "0")}`,
      title: `Workout ${i + 1}`,
      description: null,
      start_time: new Date(start).toISOString(),
      end_time: new Date(start + 60 * 60 * 1000).toISOString(),
      exercises,
    };
  });
}

/**
 * Test-only (Spec 20.1 Phase A): the 19.1 import contract in memory, as MSW handlers on the API's origin —
 * `POST /v1/hevy/import/workouts`, `POST /v1/hevy/import/finish` and `GET /v1/hevy/status`.
 * - **Links:** `hevyWorkoutId → origin`; `deleted` is a tombstone (`deleted_in_sin`).
 * - **Pairing:** with `pairedTemplateIds`, a workout using any other template is `unpaired`.
 * - **Duplicates:** `duplicateOf` maps a Hevy id to the SIN workout it matches; a SIN workout is claimed at most once
 *   per request, never across requests (19.1 AC21 / D6; 20.1 §6.6).
 * - A dry run never changes anything; a real run links what it creates or matches and marks records stale.
 * - **Finish** answers `400` if the request carries a `Content-Type` or a body (19.1 §5.2).
 */
export type ImportLinkOrigin = "imported" | "matched" | "sent" | "deleted";
export interface FakeImportOptions {
  links?: { hevyWorkoutId: string; origin: ImportLinkOrigin }[];
  pairedTemplateIds?: ReadonlySet<string>;
  duplicateOf?: ReadonlyMap<string, string>;
  outcomeFor?: (hevyWorkoutId: string) => HevyImportOutcome | undefined;
  dropsFor?: (hevyWorkoutId: string) => CodeCount<HevyImportDropCode>[];
  recordsStale?: boolean;
  /** Phase B: every import request (batch or finish) answers after this many ms (real timers), so overlap can show. */
  delayMs?: number;
}
export interface FakeImportRequest {
  path: string;
  method: string;
  contentType: string | null;
  body: unknown;
}
type ImportFailure = number | "network" | "short" | "garbage";
/** Phase B: one queued answer — a status, a network error, or a `422` naming its first error path. */
export type SequencedFailure = number | "network" | { status: 422; path: string };

const API = API_BASE_URL;
const LINKED: Record<ImportLinkOrigin, HevyImportOutcome> = {
  imported: "already_imported",
  matched: "already_matched",
  sent: "sent_from_sin",
  deleted: "deleted_in_sin",
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function fakeImportApi(options: FakeImportOptions = {}) {
  const links = new Map((options.links ?? []).map((l) => [l.hevyWorkoutId, l.origin]));
  const log: FakeImportRequest[] = [];
  const state = { recordsStale: options.recordsStale ?? false, created: 0 };
  let failure: { kind: ImportFailure; times: number } | null = null;
  let held: number | null = null;
  let batches = 0;
  const sequence: SequencedFailure[] = [];
  /** Phase B (§6.8, no overlap): requests in flight now, and the most ever in flight at once, over both import routes. */
  const concurrency = { inFlight: 0, maxInFlight: 0 };

  /** The `n`-th batch request (1-based) never answers: a check caught mid-way. */
  function holdBatch(n: number): void {
    held = n;
  }

  function failNext(kind: ImportFailure, times = 1): void {
    failure = { kind, times };
  }

  /** Phase B: the next requests fail in this order, one entry each (before any `failNext`). */
  function failSequence(kinds: readonly SequencedFailure[]): void {
    sequence.push(...kinds);
  }

  /**
   * Phase B: a new "run" on the same server. The request log and the batch counter start again; the links, the
   * created count and `recordsStale` persist (AC21: the server's links are the memory).
   */
  function reset(): void {
    log.length = 0;
    batches = 0;
    concurrency.maxInFlight = concurrency.inFlight;
  }

  /** Counts the request in flight, waits `delayMs`, and answers the next queued failure if any. */
  async function enter(): Promise<Response | null> {
    concurrency.inFlight += 1;
    concurrency.maxInFlight = Math.max(concurrency.maxInFlight, concurrency.inFlight);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    const next = sequence.shift();
    if (next === undefined) return null;
    if (next === "network") return HttpResponse.error();
    const status = typeof next === "number" ? next : next.status;
    const problem: Record<string, unknown> = { type: "https://api.strengthinnumbers.app/problems/fake", title: "Fake", status };
    if (typeof next === "object") problem["errors"] = [{ path: next.path, message: "Invalid input" }];
    return new HttpResponse(JSON.stringify(problem), { status, headers: { "content-type": "application/problem+json" } });
  }

  /** Wraps a handler so the request counts toward `concurrency` until it answers. */
  const counted =
    (handler: (request: Request) => Promise<Response>) =>
    async ({ request }: { request: Request }) => {
      try {
        return await handler(request);
      } finally {
        concurrency.inFlight -= 1;
      }
    };

  async function record(request: Request): Promise<FakeImportRequest> {
    const text = await request.text();
    let body: unknown = text === "" ? undefined : text;
    try {
      body = text === "" ? undefined : (JSON.parse(text) as unknown);
    } catch {
      /* keep the text */
    }
    const entry = { path: new URL(request.url).pathname, method: request.method, contentType: request.headers.get("content-type"), body };
    log.push(entry);
    return entry;
  }

  function resultFor(w: HevyImportWorkout, dryRun: boolean, claimed: Set<string>): HevyImportResult {
    const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
    const base = { hevyWorkoutId: w.hevyWorkoutId, workoutId: null, matchedWorkoutId: null, unpaired: [] as string[], drops: options.dropsFor?.(w.hevyWorkoutId) ?? [], notices: [], exerciseCount: w.exercises.length, setCount: sets };
    const linked = links.get(w.hevyWorkoutId);
    if (linked) return { ...base, outcome: LINKED[linked] };
    const forced = options.outcomeFor?.(w.hevyWorkoutId);
    if (forced) return { ...base, outcome: forced };
    if (options.pairedTemplateIds) {
      const unpaired = [...new Set(w.exercises.map((e) => e.exerciseTemplateId).filter((id) => !options.pairedTemplateIds!.has(id)))];
      if (unpaired.length > 0) return { ...base, outcome: "unpaired", unpaired };
    }
    const match = options.duplicateOf?.get(w.hevyWorkoutId);
    if (match !== undefined && !claimed.has(match)) {
      claimed.add(match);
      if (!dryRun) links.set(w.hevyWorkoutId, "matched");
      return { ...base, outcome: "duplicate", matchedWorkoutId: match as HevyImportResult["matchedWorkoutId"] };
    }
    if (dryRun) return { ...base, outcome: "create" };
    state.created += 1;
    state.recordsStale = true;
    links.set(w.hevyWorkoutId, "imported");
    return { ...base, outcome: "create", workoutId: uuid(state.created) as HevyImportResult["workoutId"] };
  }

  function failed(): Response | null {
    if (failure === null || failure.times <= 0 || failure.kind === "short" || failure.kind === "garbage") return null;
    failure.times -= 1;
    const { kind } = failure;
    if (kind === "network") return HttpResponse.error();
    if (typeof kind === "number") {
      const headers: Record<string, string> = { "content-type": "application/problem+json" };
      if (kind === 429) headers["retry-after"] = "2";
      return new HttpResponse(JSON.stringify({ type: "https://api.strengthinnumbers.app/problems/fake", title: "Fake", status: kind }), { status: kind, headers });
    }
    return null;
  }

  const batch = http.post(`${API}/v1/hevy/import/workouts`, counted(async (request) => {
    const entry = await record(request);
    batches += 1;
    const queued = await enter();
    if (batches === held) await new Promise<never>(() => {});
    if (queued) return queued;
    const early = failed();
    if (early) return early;
    const body = entry.body as HevyImportBatch;
    const claimed = new Set<string>();
    let results = body.workouts.map((w) => resultFor(w, body.dryRun, claimed));
    const kind = failure?.times !== undefined && failure.times > 0 ? failure.kind : null;
    if (kind === "short" || kind === "garbage") {
      failure!.times -= 1;
      if (kind === "garbage") return HttpResponse.json({ dryRun: body.dryRun, results: [{ nonsense: true }] });
      results = results.slice(1);
    }
    return HttpResponse.json({ dryRun: body.dryRun, results });
  }));

  const finish = http.post(`${API}/v1/hevy/import/finish`, counted(async (request) => {
    const entry = await record(request);
    const queued = await enter();
    if (queued) return queued;
    const early = failed();
    if (early) return early;
    if (entry.contentType !== null || entry.body !== undefined) {
      return new HttpResponse(JSON.stringify({ type: "about:blank", title: "Bad Request", status: 400 }), { status: 400, headers: { "content-type": "application/problem+json" } });
    }
    const recomputed = state.recordsStale;
    state.recordsStale = false;
    return HttpResponse.json({ recomputed, rootCount: recomputed ? 3 : 0 });
  }));

  const status = http.get(`${API}/v1/hevy/status`, () =>
    HttpResponse.json({ enabled: true, pairCount: options.pairedTemplateIds?.size ?? 0, linkCount: links.size, recordsStale: state.recordsStale }),
  );

  return { handlers: [batch, finish, status], log, links, state, concurrency, failNext, failSequence, holdBatch, reset };
}

/** A real `ApiClient` against the test API origin, for client-level tests (MSW answers it). */
export const testApiClient = () =>
  createApiClient({ baseUrl: API_BASE_URL, appEnv: "local", getToken: async () => "token", onAuthLost: () => {} });

/** One request workout with a single weight-and-reps set. */
export const makeImportWorkout = (id: string, startTime = "2026-07-01T09:00:00Z"): HevyImportWorkout => ({
  hevyWorkoutId: id,
  title: id,
  description: null,
  startTime,
  endTime: startTime,
  tzOffsetMinutes: 0,
  exercises: [
    {
      exerciseTemplateId: "T1",
      notes: null,
      supersetId: null,
      sets: [{ type: "normal", weightKg: 50, reps: 5, distanceMeters: null, durationSeconds: null, rpe: null, customMetric: null }],
    },
  ],
});
