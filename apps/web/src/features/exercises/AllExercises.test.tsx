import { screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
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
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { createWorkoutFake, problemResponse, type WorkoutFakeOptions } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { searchByName } from "../catalog/visibility";
import { EXERCISE_KEYS } from "./keys";
import { EXERCISES_COPY } from "./messages";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 25, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  onlineManager.setOnline(true);
  observability.reportError.mockReset();
  cleanupApp();
});

const USAGE = /^\/v1\/exercises\/usage$/;
const bench = makeExercise({ id: exerciseId(1), name: "Barbell bench press", ownerUserId: null });
const squat = makeExercise({ id: exerciseId(2), name: "Back squat", ownerUserId: USER_ID });
const plank = makeExercise({ id: exerciseId(3), name: "Plank", ownerUserId: null, modality: "duration" });
const echo = makeExercise({ id: exerciseId(4), name: "Echo Bike", ownerUserId: USER_ID, modality: "calories" });
const CATALOG = [bench, squat, plank, echo];
const USED = [
  { rootId: exerciseId(4), lastLoggedOn: "2026-10-24" },
  { rootId: exerciseId(1), lastLoggedOn: "2025-06-16" },
];

function setup(options: { catalog?: Exercise[]; fake?: WorkoutFakeOptions } = {}) {
  const fake = createWorkoutFake({ usage: USED, ...options.fake });
  prepareApp({ auth, fake, catalog: options.catalog ?? CATALOG });
  return { fake, ...renderApp("/app/exercises") };
}

const list = () => screen.findByRole("list", { name: EXERCISES_COPY.listLabel });
const names = (ul: HTMLElement) => within(ul).getAllByRole("link").map((a) => a.querySelector("span")?.textContent);
const search = () => screen.getByRole("searchbox", { name: EXERCISES_COPY.searchLabel });

describe("18.2 AC11 — row accessibility", () => {
  it("one link per row, named by the exercise first, to its page", async () => {
    setup();
    const ul = await list();
    expect(within(ul).getByRole("link", { name: /^Barbell bench press/ })).toHaveAttribute("href", `/app/exercises/${exerciseId(1)}`);
    for (const li of within(ul).getAllByRole("listitem")) expect(within(li).getAllByRole("link")).toHaveLength(1);
  });

  it("logged first by date, then never logged by name, with each row's meta line", async () => {
    setup();
    const ul = await list();
    expect(names(ul)).toEqual(["Echo Bike", "Barbell bench press", "Back squat", "Plank"]);
    const links = within(ul).getAllByRole("link");
    expect(links[0]).toHaveTextContent("Last logged Sat 24 Oct · Calories");
    expect(links[1]).toHaveTextContent("Last logged Mon 16 Jun 2025 · Weight × reps");
    expect(links[2]).toHaveTextContent("Yours · Weight × reps");
    expect(links[3]).toHaveTextContent("Built in · Duration");
  });
});

describe("deferred minor 122 — the count line is mounted, empty, before the first query", () => {
  it("an empty status region from first paint takes the count, then empties again", async () => {
    const { user } = setup();
    await list();
    const count = screen.getByTestId("exercise-count");
    expect(count).toHaveAttribute("role", "status");
    expect(count).toBeEmptyDOMElement();
    await user.type(search(), "bench");
    expect(count).toHaveTextContent("1 exercise");
    await user.clear(search());
    expect(count).toBeEmptyDOMElement();
  });
});

describe("18.2 AC12 — search", () => {
  it.each(["BENCH", "bénch"])("%s matches, the status counts, and clearing removes it", async (query) => {
    const { user } = setup();
    await list();
    await user.type(search(), query);
    expect(names(await list())).toEqual(["Barbell bench press"]);
    expect(screen.getByText("1 exercise")).toHaveAttribute("role", "status");
    await user.clear(search());
    expect(screen.queryByText(/^\d+ exercises?$/)).toBeNull();
  });

  it("narrowing never reorders", async () => {
    const { user } = setup();
    const before = names(await list());
    await user.type(search(), "b");
    const kept = new Set(searchByName(CATALOG, "b").map((e) => e.name));
    expect(names(await list())).toEqual(before.filter((n) => n !== undefined && kept.has(n)));
    expect(screen.getByText("3 exercises")).toBeInTheDocument();
  });
});

describe("18.2 AC13 — catalog states", () => {
  it("a spinner while the first sync is held", async () => {
    const sync = deferred<void>();
    setup({ catalog: [] });
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises`, async () => {
        await sync.promise;
        return HttpResponse.json({ exercises: CATALOG, syncToken: "1.200" });
      }),
    );
    expect(await screen.findByText(EXERCISES_COPY.loadingExercises)).toBeInTheDocument();
    sync.resolve();
    expect(names(await list())).toHaveLength(4);
  });

  it("a failed first sync shows the notice; Retry syncs again", async () => {
    let calls = 0;
    const { user } = setup({ catalog: [] });
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises`, () => {
        calls += 1;
        return calls === 1 ? problemResponse(500, "internal") : HttpResponse.json({ exercises: CATALOG, syncToken: "1.200" });
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(EXERCISES_COPY.loadExercisesFailed);
    await user.click(within(alert).getByRole("button", { name: EXERCISES_COPY.retry }));
    expect(names(await list())).toHaveLength(4);
    expect(calls).toBe(2);
  });
});

describe("18.2 AC14 — usage states", () => {
  it("(a) the list waits for usage, so the first order is final", async () => {
    const held = deferred<void>();
    setup();
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises/usage`, async () => {
        await held.promise;
        return HttpResponse.json({ exercises: USED });
      }),
    );
    expect(await screen.findByText(EXERCISES_COPY.loadingExercises)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: EXERCISES_COPY.listLabel })).toBeNull();
    held.resolve();
    expect(names(await list())).toEqual(["Echo Bike", "Barbell bench press", "Back squat", "Plank"]);
  });

  it("(b) cached usage renders at once on a second visit", async () => {
    const { router } = setup();
    await list();
    await router.navigate("/app/history");
    await screen.findByRole("heading", { level: 1, name: "History" });
    server.use(http.get(`${API_BASE_URL}/v1/exercises/usage`, () => new Promise<Response>(() => {})));
    await router.navigate("/app/exercises");
    expect(names(await list())).toEqual(["Echo Bike", "Barbell bench press", "Back squat", "Plank"]);
  });

  it("(c) a failed usage read lists A–Z with type-only lines and the notice; Try again recovers", async () => {
    const fake = createWorkoutFake({ usage: USED });
    fake.failNext({ method: "GET", path: USAGE }, () => problemResponse(500, "internal"));
    prepareApp({ auth, fake, catalog: CATALOG });
    const { user } = renderApp("/app/exercises");
    const ul = await list();
    expect(names(ul)).toEqual(["Back squat", "Barbell bench press", "Echo Bike", "Plank"]);
    expect(within(ul).getAllByRole("link")[0]).toHaveTextContent(/^Back squatWeight × reps$/);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(EXERCISES_COPY.usageFailed);
    await user.click(within(alert).getByRole("button", { name: EXERCISES_COPY.tryAgain }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(names(await list())).toEqual(["Echo Bike", "Barbell bench press", "Back squat", "Plank"]);
  });

  it("(d) a failed refetch keeps the dates and shows the notice", async () => {
    const { fake, queryClient } = setup();
    await list();
    fake.failNext({ method: "GET", path: USAGE }, () => problemResponse(500, "internal"));
    await queryClient.invalidateQueries({ queryKey: EXERCISE_KEYS.usage });
    expect(await screen.findByRole("alert")).toHaveTextContent(EXERCISES_COPY.usageFailed);
    expect(within(await list()).getAllByRole("link")[0]).toHaveTextContent("Last logged Sat 24 Oct · Calories");
  });
});

describe("18.2 AC15 — offline", () => {
  it("the list and search work, the notice shows, nothing is reported", async () => {
    const fake = createWorkoutFake({ usage: USED });
    prepareApp({ auth, fake, catalog: CATALOG });
    const { user, router, queryClient } = renderApp("/app/history");
    await screen.findByRole("heading", { level: 1, name: "History" });
    fake.setOffline(true);
    onlineManager.setOnline(false);
    await router.navigate("/app/exercises");
    expect(await screen.findByRole("alert")).toHaveTextContent(EXERCISES_COPY.usageFailed);
    await user.type(search(), "plank");
    expect(names(await list())).toEqual(["Plank"]);
    expect(observability.reportError).not.toHaveBeenCalled();
    // Back online, the paused reference reads go out before the test ends (deferred minor 121).
    fake.setOffline(false);
    onlineManager.setOnline(true);
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  });
});

describe("18.2 AC16 — empty states", () => {
  it("no exercises at all", async () => {
    setup({ catalog: [] });
    expect(await screen.findByText(EXERCISES_COPY.noExercises)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EXERCISES_COPY.newExercise })).toBeInTheDocument();
  });

  it("no match offers to create it, prefilled", async () => {
    const { user } = setup();
    await list();
    await user.type(search(), "Zercher");
    expect(screen.getByText(EXERCISES_COPY.noMatch("Zercher"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: EXERCISES_COPY.newExerciseNamed("Zercher") }));
    const sheet = await screen.findByRole("dialog", { name: EXERCISES_COPY.newExerciseSheet });
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Zercher");
  });
});

describe("18.2 AC17 — + New exercise", () => {
  it("creates, lands on the new page by push, and Back returns to the list", async () => {
    const fake = createWorkoutFake({ usage: [], serveExercises: true, catalog: CATALOG });
    prepareApp({ auth, fake, catalog: CATALOG });
    const { user, router, queryClient } = renderApp("/app/exercises");
    await list();
    const button = screen.getByRole("button", { name: EXERCISES_COPY.newExercise });
    expect(button).toHaveTextContent("+ New exercise");
    await user.click(button);
    const sheet = await screen.findByRole("dialog", { name: EXERCISES_COPY.newExerciseSheet });
    await user.type(within(sheet).getByLabelText("Name"), "Echo Bike 2");
    await user.click(within(sheet).getByRole("radio", { name: "Calories" }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.state.catalog.some((e) => e.name === "Echo Bike 2")).toBe(true));
    const created = fake.state.catalog.find((e) => e.name === "Echo Bike 2")!;
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/exercises/${created.id}`));
    expect(router.state.historyAction).toBe("PUSH");
    expect(await screen.findByRole("heading", { level: 1, name: "Echo Bike 2" })).toBeInTheDocument();
    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/exercises"));
    // The list's usage read lands before the test ends (deferred minor 121).
    await list();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  });
});

describe("18.2 AC18 — scale", () => {
  it("600 rows render, narrow to 3 and come back", async () => {
    const many = Array.from({ length: 600 }, (_, i) =>
      makeExercise({ id: exerciseId(100 + i), name: i < 3 ? `Zercher ${i}` : `Lift ${String(i).padStart(3, "0")}`, ownerUserId: USER_ID }),
    );
    const { user } = setup({ catalog: many, fake: { usage: [] } });
    expect(within(await list()).getAllByRole("listitem")).toHaveLength(600);
    await user.type(search(), "zer");
    expect(within(await list()).getAllByRole("listitem")).toHaveLength(3);
    await user.clear(search());
    expect(within(await list()).getAllByRole("listitem")).toHaveLength(600);
  }, 30_000);
});
