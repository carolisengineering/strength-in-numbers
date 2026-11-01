import { createHash } from "node:crypto";
import {
  HEVY_LINK_CLAIM_TTL_S,
  hevyFingerprintSource,
  type HevyCreateTemplateBody,
  type HevyLinkBegin,
  type HevyLinkOrigin,
  type HevyLinkState,
  type HevyMapping,
  type HevyPair,
  type HevyPostWorkout,
  type HevyWorkout,
  type HevyWorkoutPage,
  type WorkoutDetail,
} from "@sin/core";

import { http, HttpResponse } from "msw";

import { ApiError } from "../api";
import { classifyHevyResponse, HevyError } from "../features/hevy/client/hevyErrors";
import { API_BASE_URL } from "./accountHarness";
import { makeSet, makeWorkoutDetail } from "./workoutFixtures";

/**
 * Test-only (Spec 20.2): a fake link server mirroring `apps/api/src/repositories/hevy.prisma.ts` (begin, complete,
 * release, read; the claim TTL on an injected clock; the five slugs; `404` for a deleted workout), and a recording
 * fake Hevy client. Both are in memory; Task 4 serves the link server through MSW. Lives under `src/test/` because a
 * file under `features/` naming Hevy's origin fails 20.0's scans.
 */

// ---- fixtures ----

export const EXERCISE_A = "e0000000-0000-4000-8000-00000000000a";
export const EXERCISE_B = "e0000000-0000-4000-8000-00000000000b";
export const WORKOUT_ID = "f0000000-0000-4000-8000-000000000001";

const pair = (exerciseId: string, templateId: string, title: string): HevyPair => ({
  hevyTemplateId: templateId,
  hevyTitle: title,
  hevyType: "weight_reps",
  role: "exercise",
  exerciseId,
  exerciseActive: true,
  measureRule: null,
  exportAs: true,
});

/** A finished two-exercise workout and a mapping that pairs both (so `buildHevyWorkout` succeeds). */
export function sendFixture(over: Parameters<typeof makeWorkoutDetail>[0] = {}) {
  const detail = makeWorkoutDetail({
    id: WORKOUT_ID,
    title: "Push A",
    startedAt: "2026-10-24T17:05:00.000Z",
    endedAt: "2026-10-24T18:10:00.000Z",
    exercises: [
      { exerciseId: EXERCISE_A, name: "Bench Press", modality: "weight_reps", sets: [makeSet(), makeSet({ weight: 70 })] },
      { exerciseId: EXERCISE_B, name: "Row", modality: "weight_reps", sets: [makeSet()] },
    ],
    ...over,
  });
  const mapping: HevyMapping = { pairs: [pair(EXERCISE_A, "T-BENCH", "Bench Press (Barbell)"), pair(EXERCISE_B, "T-ROW", "Bent Over Row (Barbell)")], sectionRules: [] };
  return { detail, mapping };
}

export const hevyFingerprintOf = (detail: WorkoutDetail) => `v1:${createHash("sha256").update(hevyFingerprintSource(detail), "utf8").digest("hex")}`;

// ---- the link server ----

const problem = (status: number, slug: string) =>
  new ApiError({ status, type: `https://api.strengthinnumbers.app/problems/${slug}`, title: slug, requestId: "fake" });
export const networkError = () => new ApiError({ status: 0, type: "about:blank", title: "Network error", requestId: "", isNetworkError: true });

export interface LinkRow {
  hevyWorkoutId: string | null;
  origin: HevyLinkOrigin;
  claimedAt: number | null;
  /** Spec 19.0 D29: the begin's fingerprint while a claim is held (NULL for a claim seeded as from before 0017). */
  claimFingerprint?: string | null;
  fingerprint: string | null;
  syncedAt: string | null;
}
type LinkOp = "read" | "begin" | "complete" | "release";
export type LinkFailure = number | "network" | { status: number; slug: string };
export interface LinkRequest {
  method: string;
  path: string;
  body: unknown;
}

export function fakeHevyLink(opts: { detailOf: (id: string) => WorkoutDetail | null; now?: () => number }) {
  const now = opts.now ?? (() => Date.now());
  const rows = new Map<string, LinkRow>();
  const log: LinkRequest[] = [];
  const failures = new Map<LinkOp, LinkFailure[]>();
  const fresh = (row: LinkRow) => row.claimedAt !== null && now() - row.claimedAt < HEVY_LINK_CLAIM_TTL_S * 1000;

  function fail(op: LinkOp, ...kinds: LinkFailure[]): void {
    failures.set(op, [...(failures.get(op) ?? []), ...kinds]);
  }
  function injected(op: LinkOp): void {
    const next = failures.get(op)?.shift();
    if (next === undefined) return;
    if (next === "network") throw networkError();
    if (typeof next === "number") throw problem(next, next >= 500 ? "internal" : "fake");
    throw problem(next.status, next.slug);
  }
  function owned(id: string): WorkoutDetail {
    const detail = opts.detailOf(id);
    if (detail === null) throw problem(404, "not-found");
    return detail;
  }

  function read(id: string): HevyLinkState {
    const detail = owned(id);
    const none: HevyLinkState = { state: "none", hevyWorkoutId: null, origin: null, syncedAt: null };
    const row = rows.get(id);
    if (detail.endedAt === null || !row) return none;
    if (row.hevyWorkoutId === null) return fresh(row) ? { state: "sending", hevyWorkoutId: null, origin: null, syncedAt: null } : none;
    const sent = row.fingerprint === hevyFingerprintOf(detail);
    return { state: sent ? "sent" : "changed", hevyWorkoutId: row.hevyWorkoutId, origin: row.origin, syncedAt: row.syncedAt };
  }

  function begin(id: string, relink: boolean): HevyLinkBegin {
    const detail = owned(id);
    if (detail.endedAt === null) throw problem(409, "hevy-workout-not-finished");
    const row = rows.get(id);
    const fingerprint = hevyFingerprintOf(detail);
    if (!row) {
      rows.set(id, { hevyWorkoutId: null, origin: "sent", claimedAt: now(), claimFingerprint: fingerprint, fingerprint: null, syncedAt: null });
      return { mode: "create", hevyWorkoutId: null, staleClaim: false, fingerprint };
    }
    if (row.claimedAt !== null && fresh(row)) throw problem(409, "hevy-send-in-progress");
    const staleClaim = row.claimedAt !== null;
    if (row.hevyWorkoutId === null || relink) {
      rows.set(id, { ...row, hevyWorkoutId: null, origin: "sent", claimedAt: now(), claimFingerprint: fingerprint });
      return { mode: "create", hevyWorkoutId: null, staleClaim, fingerprint };
    }
    rows.set(id, { ...row, claimedAt: now(), claimFingerprint: fingerprint });
    return { mode: "update", hevyWorkoutId: row.hevyWorkoutId, staleClaim, fingerprint };
  }

  function complete(id: string, body: { hevyWorkoutId: string; fingerprint: string }): HevyLinkState {
    owned(id);
    const row = rows.get(id);
    if (!row) throw problem(409, "hevy-no-claim");
    if (row.claimedAt === null && row.hevyWorkoutId === body.hevyWorkoutId && row.fingerprint === body.fingerprint) return read(id);
    if (row.hevyWorkoutId !== null && row.hevyWorkoutId !== body.hevyWorkoutId) throw problem(409, "hevy-link-conflict");
    if (row.claimedAt === null) throw problem(409, "hevy-no-claim");
    // D29 (minors 139, 144): another fingerprint than the begin's is refused, the claim kept; NULL completes as before.
    const stored = row.claimFingerprint ?? null;
    if (stored !== null && stored !== body.fingerprint) throw problem(409, "hevy-no-claim");
    for (const [other, r] of rows) if (other !== id && r.hevyWorkoutId === body.hevyWorkoutId) throw problem(409, "hevy-id-in-use");
    rows.set(id, {
      ...row,
      hevyWorkoutId: body.hevyWorkoutId,
      fingerprint: stored ?? body.fingerprint,
      syncedAt: new Date(now()).toISOString(),
      claimedAt: null,
      claimFingerprint: null,
    });
    return read(id);
  }

  function release(id: string): void {
    owned(id);
    const row = rows.get(id);
    if (!row) return;
    if (row.hevyWorkoutId === null) rows.delete(id);
    else rows.set(id, { ...row, claimedAt: null, claimFingerprint: null });
  }

  const idOf = (path: string) => /\/v1\/workouts\/([^/]+)\/hevy-link$/.exec(path)?.[1] ?? "";

  /** One call, as the API answers it: the value, or a thrown `ApiError`. */
  function handle(method: string, path: string, body: unknown): unknown {
    log.push({ method, path, body });
    const id = idOf(path);
    switch (method) {
      case "GET":
        injected("read");
        return read(id);
      case "POST":
        injected("begin");
        return begin(id, (body as { relink?: true } | undefined)?.relink === true);
      case "PUT":
        injected("complete");
        return complete(id, body as { hevyWorkoutId: string; fingerprint: string });
      case "DELETE":
        injected("release");
        release(id);
        return undefined;
    }
    throw new Error(`unexpected ${method} ${path}`);
  }

  /** `Pick<ApiClient, "get" | "post" | "request" | "delete">`, answering like the real client (schemas applied). */
  const api = {
    get: async <T>(path: string, schema?: { parse(v: unknown): T }) => {
      const value = handle("GET", path, undefined);
      return (schema ? schema.parse(value) : value) as T;
    },
    post: async <T>(path: string, body?: unknown, schema?: { parse(v: unknown): T }) => {
      const value = handle("POST", path, body);
      return (schema ? schema.parse(value) : value) as T;
    },
    request: async <T>(path: string, options: { method?: string; body?: unknown; schema?: { parse(v: unknown): T } } = {}) => {
      const value = handle(options.method ?? "GET", path, options.body);
      return (options.schema ? options.schema.parse(value) : value) as T;
    },
    delete: async <T>(path: string) => handle("DELETE", path, undefined) as T,
  };

  return {
    api,
    handle,
    log,
    rows,
    fail,
    read,
    /** A linked row, as a completed send (or an import, `origin: "imported"`) leaves it. */
    link(id: string, hevyWorkoutId: string, origin: HevyLinkOrigin = "sent", fingerprint?: string) {
      const detail = owned(id);
      rows.set(id, { hevyWorkoutId, origin, claimedAt: null, fingerprint: fingerprint ?? hevyFingerprintOf(detail), syncedAt: "2026-10-24T18:20:00.000Z" });
    },
    /** A claim-only row taken `ageMs` ago (an earlier send interrupted). */
    claim(id: string, ageMs: number) {
      rows.set(id, { hevyWorkoutId: null, origin: "sent", claimedAt: now() - ageMs, fingerprint: null, syncedAt: null });
    },
  };
}

// ---- the Hevy client ----

export type HevyFailureMode = "400" | "403" | "403-limit" | "404" | "429" | "5xx" | "network" | "accept-then-lose";
type HevyOp = "create" | "update" | "list" | "template";
export interface HevyCall {
  op: HevyOp;
  id?: string;
  body?: unknown;
  page?: number;
}

function hevyError(mode: Exclude<HevyFailureMode, "accept-then-lose">): HevyError {
  if (mode === "network") return new HevyError("network");
  const status = mode === "5xx" ? 503 : Number(mode.slice(0, 3));
  const body = mode === "403-limit" ? { error: "exceeds-custom-exercise-limit" } : { error: "<b>bad</b>" };
  return new HevyError(classifyHevyResponse(status, body), { status });
}

/** A recording fake of the Hevy client's write and list methods; ids are `h1`, `h2`… (templates `t1`…). */
export function fakeHevyWrites(opts: { workouts?: HevyWorkout[] } = {}) {
  const store = new Map<string, HevyWorkout>((opts.workouts ?? []).map((w) => [w.id, w]));
  const calls: HevyCall[] = [];
  const failures = new Map<HevyOp, HevyFailureMode[]>();
  let next = 0;
  let templates = 0;

  function fail(op: HevyOp, ...modes: HevyFailureMode[]): void {
    failures.set(op, [...(failures.get(op) ?? []), ...modes]);
  }
  /** As Hevy stores it: the exercises kept, in order (the lost-response check counts those with sets, minor 262). */
  const asWorkout = (id: string, body: HevyPostWorkout): HevyWorkout => ({
    id,
    title: body.workout.title,
    start_time: body.workout.start_time,
    end_time: body.workout.end_time,
    exercises: body.workout.exercises.map((e, index) => ({
      index,
      title: e.exercise_template_id,
      exercise_template_id: e.exercise_template_id,
      superset_id: e.superset_id,
      notes: e.notes,
      sets: e.sets.map((set, i) => ({ ...set, index: i })),
    })),
  });
  /** Throws the queued failure, if any; "accept-then-lose" runs `accept` first. */
  function maybeFail(op: HevyOp, accept?: () => void): void {
    const mode = failures.get(op)?.shift();
    if (mode === undefined) return;
    if (mode === "accept-then-lose") {
      accept?.();
      throw new HevyError("network");
    }
    throw hevyError(mode);
  }

  const client = {
    createWorkout: async (body: HevyPostWorkout): Promise<HevyWorkout> => {
      calls.push({ op: "create", body });
      const id = `h${(next += 1)}`;
      maybeFail("create", () => store.set(id, asWorkout(id, body)));
      const w = asWorkout(id, body);
      store.set(id, w);
      return w;
    },
    updateWorkout: async (id: string, body: HevyPostWorkout): Promise<HevyWorkout> => {
      calls.push({ op: "update", id, body });
      maybeFail("update", () => store.set(id, asWorkout(id, body)));
      if (!store.has(id)) throw hevyError("404");
      const w = asWorkout(id, body);
      store.set(id, w);
      return w;
    },
    listWorkouts: async (page: number): Promise<HevyWorkoutPage> => {
      calls.push({ op: "list", page });
      maybeFail("list");
      const all = [...store.values()].sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
      return { page, page_count: Math.max(1, Math.ceil(all.length / 10)), workouts: all.slice((page - 1) * 10, page * 10) };
    },
    createTemplate: async (body: HevyCreateTemplateBody): Promise<{ id: string }> => {
      calls.push({ op: "template", body });
      maybeFail("template");
      return { id: `t${(templates += 1)}` };
    },
  };

  return { client, calls, store, fail, writes: () => calls.filter((c) => c.op === "create" || c.op === "update") };
}

// ---- MSW: the same fakes on the wire ----

const HEVY = "https://api.hevyapp.com";

/** An `ApiError` thrown by the fake link server, as the API would answer it. */
function asProblemResponse(err: unknown): Response {
  if (err instanceof ApiError && err.isNetworkError) return HttpResponse.error();
  if (err instanceof ApiError) {
    return new HttpResponse(JSON.stringify({ type: `https://api.strengthinnumbers.app/problems/${err.type}`, title: err.title, status: err.status }), {
      status: err.status,
      headers: { "content-type": "application/problem+json" },
    });
  }
  throw err;
}

/** `GET` / `POST` / `PUT` / `DELETE …/v1/workouts/:id/hevy-link` on the SIN origin, served by `link`. Register per test. */
export function hevyLinkHandlers(link: ReturnType<typeof fakeHevyLink>, opts: { hold?: (method: string) => Promise<void> | undefined } = {}) {
  return [
    http.all(`${API_BASE_URL}/v1/workouts/:id/hevy-link`, async ({ request }) => {
      const text = request.method === "GET" || request.method === "DELETE" ? "" : await request.text();
      await opts.hold?.(request.method);
      try {
        const value = link.handle(request.method, new URL(request.url).pathname, text === "" ? undefined : JSON.parse(text));
        return value === undefined ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(value);
      } catch (err) {
        return asProblemResponse(err);
      }
    }),
  ];
}

/** A `HevyError` from the fake client, as Hevy would answer it (the real client classifies it again). */
function asHevyResponse(err: unknown): Response {
  if (err instanceof HevyError && err.kind === "network") return HttpResponse.error();
  if (err instanceof HevyError) {
    const body = err.kind === "limit" ? { error: "exceeds-custom-exercise-limit" } : { error: "<b>bad</b>" };
    return HttpResponse.json(body, { status: err.status ?? 500 });
  }
  throw err;
}

/** Hevy's workouts (`POST`, `PUT`, paged `GET`) and `POST /v1/exercise_templates`, served by `hevy`. Register per test. */
export function hevyApiHandlers(hevy: ReturnType<typeof fakeHevyWrites>, opts: { hold?: (op: "create" | "update") => Promise<void> | undefined } = {}) {
  const answer = async (fn: () => Promise<unknown>) => {
    try {
      return HttpResponse.json((await fn()) as Record<string, unknown>);
    } catch (err) {
      return asHevyResponse(err);
    }
  };
  return [
    http.post(`${HEVY}/v1/workouts`, async ({ request }) => {
      const body = (await request.json()) as HevyPostWorkout;
      await opts.hold?.("create");
      return answer(async () => ({ workout: [await hevy.client.createWorkout(body)] }));
    }),
    http.put(`${HEVY}/v1/workouts/:id`, async ({ request, params }) => {
      const body = (await request.json()) as HevyPostWorkout;
      await opts.hold?.("update");
      return answer(() => hevy.client.updateWorkout(String(params["id"]), body));
    }),
    http.get(`${HEVY}/v1/workouts`, ({ request }) => answer(() => hevy.client.listWorkouts(Number(new URL(request.url).searchParams.get("page") ?? "1")))),
    http.post(`${HEVY}/v1/exercise_templates`, async ({ request }) => {
      const body = (await request.json()) as HevyCreateTemplateBody;
      return answer(() => hevy.client.createTemplate(body));
    }),
  ];
}
