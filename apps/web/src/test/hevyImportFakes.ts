import type { HevyFolder, HevyRoutine, HevySet, HevyWorkout } from "@sin/core";
import { http, HttpResponse } from "msw";

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
