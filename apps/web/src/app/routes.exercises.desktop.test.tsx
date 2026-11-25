import { act, screen, waitFor, within } from "@testing-library/react";
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

import type { Exercise } from "@sin/core";
import { HttpResponse, http } from "msw";
import { API_BASE_URL, USER_ID } from "../test/catalogHarness";
import { server } from "../test/msw/server";
import { makeExercise } from "../test/catalogFixtures";
import { resetDesktop, setDesktop } from "../test/desktop";
import { makePersonalRecord, makeProgressPoint } from "../test/workoutFixtures";
import { createWorkoutFake, type WorkoutFakeOptions } from "../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../test/workoutHarness";
import { EXERCISES_COPY } from "../features/exercises/messages";
import { EXERCISES_PATH, RECORDS_PATH, exercisePath } from "../features/exercises/paths";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 20, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  resetDesktop();
  cleanupApp();
});

const BENCH = "10000000-0000-4000-8000-0000000000b1";
const PULL = "10000000-0000-4000-8000-0000000000b2";
const SQUAT = "10000000-0000-4000-8000-0000000000b3";
const FORK = "10000000-0000-4000-8000-0000000000b4";
const ECHO = "10000000-0000-4000-8000-0000000000b5";

const bench = makeExercise({ id: BENCH, name: "Barbell bench press", ownerUserId: null });
const pull = makeExercise({ id: PULL, name: "Pull-up", ownerUserId: null, modality: "bodyweight_reps" });
const squat = makeExercise({ id: SQUAT, name: "Back squat", ownerUserId: null });
const echo = makeExercise({ id: ECHO, name: "Echo Bike", ownerUserId: USER_ID, modality: "calories" });

const on = (...dates: string[]) => dates.map((localDate) => makeProgressPoint({ localDate }));
/** Bench is the most recently logged, then Pull-up; Back squat was never logged. */
const PROGRESS = { [BENCH]: on("2026-09-01", "2026-10-06"), [PULL]: on("2026-08-01", "2026-09-15") };

const SERIES = /^\/v1\/progress\/exercises\//;
const progressGets = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => SERIES.test(r.path) || (r.path === "/v1/personal-records" && r.search.includes("exerciseId")));

const panes = () => [...document.querySelectorAll<HTMLElement>("[data-pane]")];
/** The app draws the shell once `/v1/me` answers; wide tests wait for both panes before looking inside them. */
const panesReady = () => waitFor(() => expect(panes()).toHaveLength(2));
const listPane = () => panes()[0]!;
const detailPane = () => panes()[1]!;

async function setup(path: string, options: { wide?: boolean; catalog?: Exercise[]; fake?: WorkoutFakeOptions } = {}) {
  const wide = options.wide ?? true;
  if (wide) setDesktop(true);
  const fake = createWorkoutFake({
    serveExercises: true,
    catalog: options.catalog ?? [bench, pull, squat],
    progress: PROGRESS,
    records: [
      makePersonalRecord({ exerciseId: BENCH, exerciseName: "Barbell bench press", localDate: "2026-10-06" }),
      makePersonalRecord({ exerciseId: PULL, exerciseName: "Pull-up", localDate: "2026-09-15" }),
    ],
    ...options.fake,
  });
  prepareApp({ auth, fake, catalog: options.catalog ?? [bench, pull, squat] });
  const app = renderApp(path);
  if (wide) await panesReady();
  return { fake, ...app };
}

const detailTitle = (name: string) => within(detailPane()).findByRole("heading", { level: 1, name });
const rowLink = (name: string | RegExp) => within(listPane()).findByRole("link", { name: typeof name === "string" ? new RegExp(`^${name}`) : name });
const viewSwitch = () => within(listPane()).getByRole("navigation", { name: EXERCISES_COPY.viewsLabel });
const detailsOf = () => within(detailPane()).getByText(EXERCISES_COPY.detailsLabel).closest("details")!;

describe("17.12 AC20 — Exercises' URLs don't change, and the phone is today's", () => {
  it("narrow: /app/exercises/:id is the page alone (no switch, no panes); the list routes are as on main", async () => {
    const { router } = await setup(exercisePath(BENCH), { wide: false });
    expect(await screen.findByRole("heading", { level: 1, name: "Barbell bench press" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: EXERCISES_COPY.backToExercises })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: EXERCISES_COPY.viewsLabel })).toBeNull();
    expect(panes()).toEqual([]);

    await act(() => router.navigate(EXERCISES_PATH));
    expect(await screen.findByRole("list", { name: EXERCISES_COPY.listLabel })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: EXERCISES_COPY.title })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: EXERCISES_COPY.viewsLabel })).toBeInTheDocument();
    expect(panes()).toEqual([]);

    await act(() => router.navigate(RECORDS_PATH));
    expect(await screen.findByRole("list", { name: "Exercises" })).toBeInTheDocument();
    expect(panes()).toEqual([]);
  });

  it("narrow: switching views keeps the switch mounted, so focus stays on the link pressed", async () => {
    const { router, user } = await setup(EXERCISES_PATH, { wide: false });
    const views = await screen.findByRole("navigation", { name: EXERCISES_COPY.viewsLabel });
    const records = within(views).getByRole("link", { name: EXERCISES_COPY.recordsView });
    await user.click(records);
    await waitFor(() => expect(router.state.location.pathname).toBe(RECORDS_PATH));
    expect(await screen.findByRole("list", { name: "Exercises" })).toBeInTheDocument();
    expect(records).toBeInTheDocument();
    expect(document.activeElement).toBe(records);
  });

  it("wide: /app/exercises/:id is two plain panes, the switch and list, then the page (D7)", async () => {
    await setup(exercisePath(PULL));
    for (const pane of panes()) {
      expect(pane).not.toHaveAttribute("role");
      expect(pane).not.toHaveAttribute("aria-label");
    }
    expect(viewSwitch()).toBeInTheDocument();
    expect(await within(listPane()).findByRole("list", { name: EXERCISES_COPY.listLabel })).toBeInTheDocument();
    expect(await detailTitle("Pull-up")).toBeInTheDocument();
    expect(within(detailPane()).queryByRole("navigation", { name: EXERCISES_COPY.viewsLabel })).toBeNull();
  });

  it("review focus 6: the phone's requests on /app/exercises/:id are today's, in today's order", async () => {
    const { fake } = await setup(exercisePath(BENCH), { wide: false });
    await screen.findByRole("heading", { level: 1, name: "Barbell bench press" });
    await waitFor(() => expect(progressGets(fake)).toHaveLength(2));
    const gets = fake.requests.filter((r) => r.method === "GET").map((r) => `${r.path}${r.search}`);
    expect(gets).toEqual(PHONE_EXERCISE_PAGE_GETS);
  });
});

describe("17.12 AC20 — the phone's Records view sends today's requests (AC30, final review I1)", () => {
  it("narrow /app/exercises/records reads the records list and nothing else (no catalog sync)", async () => {
    const { fake } = await setup(RECORDS_PATH, { wide: false });
    expect(await screen.findByRole("list", { name: "Exercises" })).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    const gets = fake.requests.filter((r) => r.method === "GET").map((r) => `${r.path}${r.search}`);
    expect(gets).toEqual(["/v1/personal-records"]);
  });
});

/** Pinned from `main` (3c51077a) before Phase C (review focus 6). */
const PHONE_EXERCISE_PAGE_GETS: string[] = [
  `/v1/personal-records?exerciseId=${BENCH}`,
  "/v1/exercises/usage",
  "/v1/exercises?since=1.100",
  `/v1/progress/exercises/${BENCH}?from=2026-07-20`,
];

describe("17.12 AC21 — /app/exercises opens the most recently logged exercise", () => {
  it("wide: the detail is Bench (newest logged), with no redirect", async () => {
    const { router } = await setup(EXERCISES_PATH);
    expect(await detailTitle("Barbell bench press")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(EXERCISES_PATH);
    expect(await rowLink("Barbell bench press")).toHaveAttribute("aria-current", "page");
  });

  it("review focus 4: an account with nothing logged says Choose an exercise and reads no series or records", async () => {
    const { fake } = await setup(EXERCISES_PATH, { fake: { progress: {}, records: [] } });
    expect(await detailTitle(EXERCISES_COPY.chooseExercise)).toBeInTheDocument();
    expect(await within(listPane()).findByRole("link", { name: /^Back squat/ })).not.toHaveAttribute("aria-current");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(progressGets(fake)).toEqual([]);
  });
});

describe("17.12 AC22 — selection and headings", () => {
  it("one h1, the exercise's name; Exercises is an h2; the row is current; no Back link in the detail", async () => {
    await setup(exercisePath(PULL));
    expect(await detailTitle("Pull-up")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(listPane()).getByRole("heading", { level: 2, name: EXERCISES_COPY.title })).toBeInTheDocument();
    expect(await rowLink("Pull-up")).toHaveAttribute("aria-current", "page");
    expect(await rowLink("Barbell bench press")).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: EXERCISES_COPY.backToExercises })).toBeNull();
  });

  it("choosing another row opens it in the detail; the list stays", async () => {
    const { router, user } = await setup(EXERCISES_PATH);
    await detailTitle("Barbell bench press");
    const list = within(listPane()).getByRole("list", { name: EXERCISES_COPY.listLabel });
    await user.click(await rowLink("Pull-up"));
    expect(await detailTitle("Pull-up")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(exercisePath(PULL));
    expect(within(listPane()).getByRole("list", { name: EXERCISES_COPY.listLabel })).toBe(list);
  });

  it("choosing an exercise opens it fresh: back to a cached one, its disclosure is closed again", async () => {
    const { user } = await setup(exercisePath(BENCH));
    await detailTitle("Barbell bench press");
    await user.click(within(detailPane()).getByText(EXERCISES_COPY.detailsLabel));
    expect(detailsOf().open).toBe(true);
    await user.click(await rowLink("Pull-up"));
    await detailTitle("Pull-up");
    await user.click(await rowLink("Barbell bench press"));
    await detailTitle("Barbell bench press");
    expect(detailsOf().open).toBe(false);
  });

  it("review focus 2: a fork origin's id replaces to the newest fork, and the fork's row is current", async () => {
    const fork = makeExercise({ id: FORK, name: "My bench", ownerUserId: USER_ID, forkedFromExerciseId: BENCH, createdAt: "2026-05-01T00:00:00.000Z" });
    const { router } = await setup(exercisePath(BENCH), {
      catalog: [bench, pull, fork],
      fake: { progress: { ...PROGRESS, [FORK]: PROGRESS[BENCH]! } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(exercisePath(FORK)));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(await detailTitle("My bench")).toBeInTheDocument();
    expect(await rowLink("My bench")).toHaveAttribute("aria-current", "page");
  });
});

describe("17.12 AC20 — Records at wide widths (review focus 1)", () => {
  it("the list pane shows Records; a Records row keeps Records; All exercises goes back to /app/exercises", async () => {
    const { router, user } = await setup(RECORDS_PATH);
    const records = await within(listPane()).findByRole("list", { name: "Exercises" });
    expect(await detailTitle("Barbell bench press")).toBeInTheDocument();
    expect(within(viewSwitch()).getByRole("link", { name: EXERCISES_COPY.recordsView })).toHaveAttribute("aria-current", "true");

    await user.click(within(records).getByRole("link", { name: /^Pull-up/ }));
    expect(await detailTitle("Pull-up")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(exercisePath(PULL));
    expect(within(listPane()).getByRole("list", { name: "Exercises" })).toBeInTheDocument();
    expect(within(listPane()).queryByRole("list", { name: EXERCISES_COPY.listLabel })).toBeNull();
    expect(within(listPane()).getByRole("link", { name: /^Pull-up/ })).toHaveAttribute("aria-current", "page");
    expect(within(viewSwitch()).getByRole("link", { name: EXERCISES_COPY.recordsView })).toHaveAttribute("aria-current");

    await user.click(within(viewSwitch()).getByRole("link", { name: EXERCISES_COPY.allView }));
    await waitFor(() => expect(router.state.location.pathname).toBe(EXERCISES_PATH));
    expect(await within(listPane()).findByRole("list", { name: EXERCISES_COPY.listLabel })).toBeInTheDocument();
  });
});

describe("17.12 AC22 — code review fixes", () => {
  it("#1: a forked exercise's Records row (keyed by the built-in) is the selected one when the copy is open", async () => {
    const fork = makeExercise({ id: FORK, name: "My bench", ownerUserId: USER_ID, forkedFromExerciseId: BENCH, createdAt: "2026-05-01T00:00:00.000Z" });
    await setup(RECORDS_PATH, { catalog: [bench, pull, fork], fake: { progress: { ...PROGRESS, [FORK]: PROGRESS[BENCH]! } } });
    expect(await detailTitle("My bench")).toBeInTheDocument();
    const records = await within(listPane()).findByRole("list", { name: "Exercises" });
    expect(within(records).getByRole("link", { name: /^Barbell bench press/ })).toHaveAttribute("aria-current", "page");
    expect(within(records).getByRole("link", { name: /^Pull-up/ })).not.toHaveAttribute("aria-current");
  });

  it("#2: beside an exercise the shown view is current, not the current page (the row is the page)", async () => {
    await setup(EXERCISES_PATH);
    await detailTitle("Barbell bench press");
    expect(within(viewSwitch()).getByRole("link", { name: EXERCISES_COPY.allView })).toHaveAttribute("aria-current", "true");
    expect(within(listPane()).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it("#6: /app/exercises/records/ (a trailing slash) is still Records, never an exercise called \"records\"", async () => {
    const { fake } = await setup(`${RECORDS_PATH}/`);
    expect(await within(listPane()).findByRole("list", { name: "Exercises" })).toBeInTheDocument();
    expect(await detailTitle("Barbell bench press")).toBeInTheDocument();
    expect(fake.requests.some((r) => r.path.includes("/records") && r.path !== "/v1/personal-records")).toBe(false);
    expect(fake.requests.some((r) => r.search.includes("exerciseId=records"))).toBe(false);
  });
});

describe("17.12 AC24 — details stay in the disclosure at wide widths", () => {
  it("a logged exercise's Exercise details is closed", async () => {
    await setup(exercisePath(BENCH));
    await detailTitle("Barbell bench press");
    expect(detailsOf().open).toBe(false);
  });
});

describe("17.12 AC20 — deleting the open exercise (review focus 3)", () => {
  it("lands on the list with the notice, and the detail is the next most recent, never the deleted one", async () => {
    const { router, user } = await setup(exercisePath(ECHO), {
      catalog: [bench, pull, echo],
      fake: { progress: { ...PROGRESS, [ECHO]: on("2026-10-10") } },
    });
    await detailTitle("Echo Bike");
    let sawDeleted = false;
    const watch = new MutationObserver(() => {
      if (document.body.textContent?.includes(EXERCISES_COPY.deleted)) sawDeleted = true;
    });
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });

    await user.click(within(detailPane()).getByText(EXERCISES_COPY.detailsLabel));
    await user.click(within(detailPane()).getByRole("button", { name: EXERCISES_COPY.deleteExercise }));
    const dialog = await screen.findByRole("dialog", { name: EXERCISES_COPY.deleteTitle("Echo Bike") });
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(router.state.location.pathname).toBe(EXERCISES_PATH));
    expect(await within(listPane()).findByText(EXERCISES_COPY.deletedNotice("Echo Bike"))).toBeInTheDocument();
    expect(await detailTitle("Barbell bench press")).toBeInTheDocument();
    watch.disconnect();
    expect(sawDeleted).toBe(false);
    expect(within(listPane()).queryByRole("link", { name: /^Echo Bike/ })).toBeNull();
  });
});

describe("minor 660 — the Exercises panes across a copy, a resize and Records", () => {
  /** The fake serves series by id, and the copy's id is minted by the fork. */
  const serveAnySeries = () =>
    server.use(http.get(`${API_BASE_URL}/v1/progress/exercises/:id`, ({ params }) => HttpResponse.json({ exerciseId: params["id"], points: PROGRESS[BENCH] })));

  it.each([
    ["the opened-by-default exercise", EXERCISES_PATH],
    ["/:id", exercisePath(BENCH)],
  ])("wide, Make your own copy from %s: the copy replaces the page beside the list", async (_label, path) => {
    const { fake, router, user } = await setup(path);
    serveAnySeries(); // after setup: prepareApp's handlers are newer than anything used before it

    await detailTitle("Barbell bench press");
    await user.click(within(detailPane()).getByText(EXERCISES_COPY.detailsLabel));
    await user.click(within(detailPane()).getByRole("button", { name: EXERCISES_COPY.makeCopy }));
    await waitFor(() => expect(fake.state.catalog.some((e) => e.forkedFromExerciseId === BENCH)).toBe(true));
    const made = fake.state.catalog.find((e) => e.forkedFromExerciseId === BENCH)!;
    await waitFor(() => expect(router.state.location.pathname).toBe(exercisePath(made.id)));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(panes()).toHaveLength(2);
    expect(await detailTitle("Barbell bench press")).toBeInTheDocument();
    await waitFor(() => expect(within(detailPane()).getByTestId("exercise-status")).toHaveTextContent(EXERCISES_COPY.copyReady));
  });

  it("across 64rem on /:id: the page alone, then beside the list again with its row current", async () => {
    await setup(exercisePath(BENCH));
    await detailTitle("Barbell bench press");
    act(() => setDesktop(false));
    expect(panes()).toEqual([]);
    expect(screen.getByRole("heading", { level: 1, name: "Barbell bench press" })).toBeInTheDocument();
    act(() => setDesktop(true));
    await panesReady();
    expect(await detailTitle("Barbell bench press")).toBeInTheDocument();
    expect(await rowLink("Barbell bench press")).toHaveAttribute("aria-current", "page");
  });

  it("Records whose top row isn't the most recently logged exercise: the detail is still the most recent", async () => {
    const records = [
      makePersonalRecord({ exerciseId: BENCH, exerciseName: "Barbell bench press", localDate: "2026-10-06", achievedAt: "2026-10-06T10:00:00.000Z" }),
      makePersonalRecord({ exerciseId: PULL, exerciseName: "Pull-up", localDate: "2026-10-08", achievedAt: "2026-10-08T10:00:00.000Z" }),
    ];
    await setup(RECORDS_PATH, { fake: { records } });
    const list = await within(listPane()).findByRole("list", { name: "Exercises" });
    const links = within(list).getAllByRole("link");
    expect(links[0]).toHaveAccessibleName(/^Pull-up/);
    expect(links[0]).not.toHaveAttribute("aria-current");
    expect(await detailTitle("Barbell bench press")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /^Barbell bench press/ })).toHaveAttribute("aria-current", "page");
  });
});
