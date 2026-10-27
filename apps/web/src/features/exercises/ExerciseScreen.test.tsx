import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false,
    isAuthenticated: true,
    error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { Exercise } from "@sin/core";
import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { makePersonalRecord, makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse, type WorkoutFakeOptions } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { EXERCISE_KEYS } from "./keys";
import { EXERCISES_COPY } from "./messages";
import { exercisePath } from "./paths";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 8, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  observability.reportError.mockReset();
  cleanupApp();
});

const ID = "10000000-0000-4000-8000-0000000000b1";
const OTHER = "10000000-0000-4000-8000-0000000000b2";
const FORK = "10000000-0000-4000-8000-0000000000b3";
const GONE = "10000000-0000-4000-8000-0000000000ff";
const SERIES = /^\/v1\/progress\/exercises\//;

const bench = makeExercise({ id: ID, name: "Barbell bench press", ownerUserId: null });
const pull = makeExercise({ id: OTHER, name: "Pull-up", ownerUserId: null, modality: "bodyweight_reps" });
const points = [makeProgressPoint({ localDate: "2026-09-01" }), makeProgressPoint({ localDate: "2026-10-06" })];

function setup(
  options: {
    catalog?: Exercise[];
    path?: string;
    fake?: WorkoutFakeOptions;
  } = {},
) {
  const fake = createWorkoutFake({
    progress: { [ID]: points, [OTHER]: points },
    records: [makePersonalRecord({ exerciseId: ID, exerciseName: "Bench (from records)" })],
    ...options.fake,
  });
  prepareApp({ auth, fake, catalog: options.catalog ?? [bench, pull] });
  return { fake, ...renderApp(options.path ?? exercisePath(ID)) };
}

const progressGets = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => SERIES.test(r.path) || (r.path === "/v1/personal-records" && r.search.includes("exerciseId")));

describe("18.2 AC19 — resolution on screen", () => {
  it("a cold store shows the spinner, then the page once the first sync lands", async () => {
    const sync = deferred<void>();
    const { fake } = setup({ catalog: [] });
    fake.requests.length = 0;
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises`, async () => {
        await sync.promise;
        return HttpResponse.json({ exercises: [bench], syncToken: "1.200" });
      }),
    );
    expect(await screen.findByText(EXERCISES_COPY.loadingExercise)).toBeInTheDocument();
    sync.resolve();
    expect(await screen.findByRole("heading", { level: 1, name: "Barbell bench press" })).toBeInTheDocument();
  });

  it("a failed first sync with an empty store shows the notice; Retry syncs again", async () => {
    let calls = 0;
    const { user } = setup({ catalog: [] });
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises`, () => {
        calls += 1;
        return calls === 1 ? problemResponse(500, "internal") : HttpResponse.json({ exercises: [bench], syncToken: "1.200" });
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(EXERCISES_COPY.loadExercisesFailed);
    await user.click(within(alert).getByRole("button", { name: EXERCISES_COPY.retry }));
    expect(await screen.findByRole("heading", { level: 1, name: "Barbell bench press" })).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("a Records row for a forked built-in lands on the copy, by replace", async () => {
    const fork = makeExercise({ id: FORK, name: "My bench", ownerUserId: USER_ID, forkedFromExerciseId: ID, createdAt: "2026-05-01T00:00:00.000Z" });
    // The API resolves a fork's id to its root (07.2 AC4); the fake keys series by id, so serve both.
    const { queryClient, router, user } = setup({ catalog: [bench, fork], path: "/app/exercises/records", fake: { progress: { [ID]: points, [FORK]: points } } });
    const list = await screen.findByRole("list", { name: "Exercises" });
    await user.click(within(list).getByRole("link", { name: /^Bench \(from records\)/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(exercisePath(FORK)));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(await screen.findByRole("heading", { level: 1, name: "My bench" })).toBeInTheDocument();
    // The redirect keeps the Records row's state, so Back still returns to Records (AC20).
    expect(screen.getByRole("link", { name: EXERCISES_COPY.backToRecords })).toHaveAttribute("href", "/app/exercises/records");
    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/exercises/records"));
    // Records refetches on return; let it land before the test ends (deferred minor 121).
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  });

  it("a synced unknown id with records is the deleted variant", async () => {
    setup({ path: exercisePath(GONE), fake: { progress: { [GONE]: points }, records: [makePersonalRecord({ exerciseId: GONE, exerciseName: "Old lift" })] } });
    expect(await screen.findByRole("heading", { level: 1, name: "Old lift" })).toBeInTheDocument();
    expect(screen.getByText(EXERCISES_COPY.deleted)).toBeInTheDocument();
  });
});

describe("18.2 AC20 — chrome", () => {
  it("the h1 is the catalog name and Back goes to Exercises by default", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Barbell bench press" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: EXERCISES_COPY.backToExercises })).toHaveAttribute("href", "/app/exercises");
    expect(screen.queryByRole("link", { name: "Back to Progress" })).toBeNull();
  });

  it("Back goes to Records when opened from a Records row", async () => {
    const { user } = setup({ path: "/app/exercises/records" });
    const list = await screen.findByRole("list", { name: "Exercises" });
    await user.click(within(list).getAllByRole("link")[0]!);
    expect(await screen.findByRole("link", { name: EXERCISES_COPY.backToRecords })).toHaveAttribute("href", "/app/exercises/records");
  });

  it("moving to another exercise remounts: range back to 3M", async () => {
    const { user, router } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    await user.click(within(screen.getByRole("group", { name: "Range" })).getByRole("button", { name: "1Y" }));
    await screen.findByRole("img", { name: /1 year/ });
    await router.navigate(exercisePath(OTHER));
    await screen.findByRole("heading", { level: 1, name: "Pull-up" });
    await screen.findByRole("img", { name: /3 months/ });
    expect(within(screen.getByRole("group", { name: "Range" })).getByRole("button", { name: "3M" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("18.2 AC21 — details block", () => {
  const details = () => screen.findByLabelText(EXERCISES_COPY.detailsLabel);
  const pairs = (dl: HTMLElement) =>
    [...dl.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? null]);

  it("a built-in, with names from the reference lists", async () => {
    setup();
    await details();
    await waitFor(() => expect(pairs(screen.getByLabelText(EXERCISES_COPY.detailsLabel))).toEqual([
      ["Source", "Built-in exercise"],
      ["Type", "Weight × reps"],
      ["Primary muscle", "Chest"],
      ["Secondary muscles", "Not set"],
      ["Equipment", "Barbell"],
    ]));
  });

  it("your own exercise", async () => {
    const mine = makeExercise({ id: ID, name: "Barbell bench press", ownerUserId: USER_ID, primaryMuscleId: null, equipmentId: null });
    setup({ catalog: [mine] });
    await details();
    expect(pairs(screen.getByLabelText(EXERCISES_COPY.detailsLabel))[0]).toEqual(["Source", "Your exercise"]);
  });

  it("your copy names its built-in", async () => {
    const fork = makeExercise({ id: FORK, name: "My bench", ownerUserId: USER_ID, forkedFromExerciseId: ID });
    setup({ catalog: [bench, fork], path: exercisePath(FORK), fake: { progress: { [FORK]: points }, usage: [{ rootId: ID, lastLoggedOn: "2026-10-06" }] } });
    await details();
    expect(pairs(screen.getByLabelText(EXERCISES_COPY.detailsLabel))[0]).toEqual(["Source", "Your copy of Barbell bench press"]);
  });
});

describe("18.2 AC22 — never logged", () => {
  it("usage known without the root: the line, and no series or records request", async () => {
    // Usage already in the cache (an earlier visit), so the page decides before rendering the body.
    const { fake, router, queryClient } = setup({ path: "/app/history", fake: { usage: [] } });
    await screen.findByRole("heading", { level: 1, name: "History" });
    queryClient.setQueryData(EXERCISE_KEYS.usage, []);
    await router.navigate(exercisePath(ID));
    expect(await screen.findByText(EXERCISES_COPY.neverLogged)).toBeInTheDocument();
    expect(screen.getByLabelText(EXERCISES_COPY.detailsLabel)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Range" })).toBeNull();
    expect(progressGets(fake)).toEqual([]);
  });

  it("deferred minor 119 — a cached never-logged answer waits for the visit's usage read; no series or records meanwhile", async () => {
    const usage = deferred<void>();
    const { fake, router, queryClient } = setup({ path: "/app/history" });
    await screen.findByRole("heading", { level: 1, name: "History" });
    // An earlier visit said never logged; a set has been logged since.
    queryClient.setQueryData(EXERCISE_KEYS.usage, []);
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises/usage`, async () => {
        await usage.promise;
        return HttpResponse.json({ exercises: [{ rootId: ID, lastLoggedOn: "2026-10-08" }] });
      }),
    );
    fake.requests.length = 0;
    await router.navigate(exercisePath(ID));
    await screen.findByRole("heading", { level: 1, name: "Barbell bench press" });
    expect(screen.queryByText(EXERCISES_COPY.neverLogged)).toBeNull();
    expect(progressGets(fake)).toEqual([]);
    usage.resolve();
    expect(await screen.findByRole("img", { name: /3 months/ })).toBeInTheDocument();
    expect(screen.queryByText(EXERCISES_COPY.neverLogged)).toBeNull();
  });

  it("usage still pending: the body renders", async () => {
    const usage = deferred<void>();
    setup();
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises/usage`, async () => {
        await usage.promise;
        return HttpResponse.json({ exercises: [] });
      }),
    );
    expect(await screen.findByRole("img", { name: /3 months/ })).toBeInTheDocument();
    expect(screen.queryByText(EXERCISES_COPY.neverLogged)).toBeNull();
    usage.resolve();
  });
});

describe("18.2 AC24 — deleted", () => {
  it("title from records, the deleted line, no details or buttons outside the body, the chart", async () => {
    setup({ path: exercisePath(GONE), fake: { progress: { [GONE]: points }, records: [makePersonalRecord({ exerciseId: GONE, exerciseName: "Old lift" })] } });
    expect(await screen.findByRole("heading", { level: 1, name: "Old lift" })).toBeInTheDocument();
    expect(screen.getByText(EXERCISES_COPY.deleted)).toBeInTheDocument();
    expect(screen.queryByLabelText(EXERCISES_COPY.detailsLabel)).toBeNull();
    expect(await screen.findByRole("img", { name: /3 months/ })).toBeInTheDocument();
    // Every button on the page belongs to the Progress body: the chips and the sessions list.
    const page = screen.getByRole("region", { name: "Old lift" });
    const outside = within(page)
      .queryAllByRole("button")
      .filter((b) => b.closest("[role='group'], ul[aria-label='Sessions']") === null);
    expect(outside).toEqual([]);
  });

  it("no records: Removed exercise", async () => {
    setup({ path: exercisePath(GONE), fake: { progress: { [GONE]: points }, records: [] } });
    expect(await screen.findByRole("heading", { level: 1, name: EXERCISES_COPY.removedExercise })).toBeInTheDocument();
  });
});

describe("deferred minors 117 / 118 — an unknown id waits for its series and records", () => {
  it("a made-up id shows the spinner, then Not found, never the deleted page", async () => {
    const series = deferred<void>();
    const fake = createWorkoutFake({ records: [] });
    fake.failNext({ method: "GET", path: SERIES }, () => problemResponse(404, "not-found"));
    prepareApp({ auth, fake, catalog: [bench] });
    server.use(
      http.get(`${API_BASE_URL}/v1/progress/exercises/:id`, async () => {
        await series.promise;
      }),
    );
    renderApp(exercisePath(GONE));
    expect(await screen.findByText(EXERCISES_COPY.loadingExercise)).toBeInTheDocument();
    expect(screen.queryByText(EXERCISES_COPY.deleted)).toBeNull();
    series.resolve();
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
  });

  it("a deleted exercise's title is its records name from the first paint", async () => {
    const records = deferred<void>();
    setup({ path: exercisePath(GONE), fake: { progress: { [GONE]: points }, records: [makePersonalRecord({ exerciseId: GONE, exerciseName: "Old lift" })] } });
    server.use(
      http.get(`${API_BASE_URL}/v1/personal-records`, async () => {
        await records.promise;
      }),
    );
    expect(await screen.findByText(EXERCISES_COPY.loadingExercise)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: EXERCISES_COPY.removedExercise })).toBeNull();
    records.resolve();
    expect(await screen.findByRole("heading", { level: 1, name: "Old lift" })).toBeInTheDocument();
  });
});

describe("deferred minor 120 — loading and error keep a heading and Back", () => {
  it("loading: an Exercise heading and Back to Exercises", async () => {
    const sync = deferred<void>();
    setup({ catalog: [] });
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises`, async () => {
        await sync.promise;
        return HttpResponse.json({ exercises: [bench], syncToken: "1.200" });
      }),
    );
    expect(await screen.findByText(EXERCISES_COPY.loadingExercise)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: EXERCISES_COPY.exerciseTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: EXERCISES_COPY.backToExercises })).toHaveAttribute("href", "/app/exercises");
    sync.resolve();
    expect(await screen.findByRole("heading", { level: 1, name: "Barbell bench press" })).toBeInTheDocument();
  });

  it("error: an Exercise heading and Back to Exercises beside the notice", async () => {
    setup({ catalog: [] });
    server.use(http.get(`${API_BASE_URL}/v1/exercises`, () => problemResponse(500, "internal")));
    expect(await screen.findByRole("alert")).toHaveTextContent(EXERCISES_COPY.loadExercisesFailed);
    expect(screen.getByRole("heading", { level: 1, name: EXERCISES_COPY.exerciseTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: EXERCISES_COPY.backToExercises })).toBeInTheDocument();
  });
});

describe("18.2 AC25 — gone is still gone", () => {
  it.each([
    ["404", () => problemResponse(404, "not-found")],
    ["422", () => problemResponse(422, "validation-error")],
  ])("a series %s with no data is NotFound for an unknown id", async (_l, fail) => {
    const fake = createWorkoutFake({ records: [] });
    fake.failNext({ method: "GET", path: SERIES }, fail);
    prepareApp({ auth, fake, catalog: [bench] });
    renderApp(exercisePath(GONE));
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
  });

  it.each([
    ["404", () => problemResponse(404, "not-found")],
    ["422", () => problemResponse(422, "validation-error")],
  ])("a series %s with no data is NotFound for a found row", async (_l, fail) => {
    const fake = createWorkoutFake({ records: [], usage: [{ rootId: ID, lastLoggedOn: "2026-10-06" }], progress: { [ID]: points } });
    fake.failNext({ method: "GET", path: SERIES }, fail);
    prepareApp({ auth, fake, catalog: [bench] });
    renderApp(exercisePath(ID));
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
  });
});
