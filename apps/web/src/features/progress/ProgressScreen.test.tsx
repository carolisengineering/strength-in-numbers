import { screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { NAV_ITEMS } from "../../app/navItems";
import { makePersonalRecord, makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.reportError.mockReset();
  onlineManager.setOnline(true);
  cleanupApp();
});

const BENCH = "10000000-0000-4000-8000-0000000000b1";
const PULL = "10000000-0000-4000-8000-0000000000b2";
const records = [
  makePersonalRecord({ exerciseId: BENCH, exerciseName: "Barbell bench press", recordType: "best_est_1rm", value: 122.5, achievedAt: "2026-10-06T10:00:00.000Z", localDate: "2026-10-06" }),
  makePersonalRecord({ exerciseId: PULL, exerciseName: "Pull-up", recordType: "max_reps", value: 15, unit: "reps", achievedAt: "2026-10-04T10:00:00.000Z", localDate: "2026-10-04" }),
];
const LIST = { method: "GET", path: /^\/v1\/personal-records$/ };

function setup(options: { records?: typeof records; unitPreference?: "kg" | "lb"; fail?: () => Response } = {}) {
  const fake = createWorkoutFake({ records: options.records ?? records, progress: { [BENCH]: [makeProgressPoint({ localDate: "2026-10-06" })] } });
  if (options.fail) fake.failNext(LIST, options.fail);
  prepareApp({ auth, fake, ...(options.unitPreference ? { unitPreference: options.unitPreference } : {}) });
  return { fake, ...renderApp("/app/progress") };
}

describe("08.1 AC10 — routes and navigation", () => {
  it("/app/progress renders Progress; no nav item is coming soon", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Progress" })).toBeInTheDocument();
    expect(NAV_ITEMS.filter((i) => i.comingSoon)).toEqual([]);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("coming-soon")).toBeNull();
  });

  it("/app/progress/:id keeps Progress highlighted", async () => {
    const { router } = setup();
    await screen.findByRole("list", { name: "Exercises" });
    await router.navigate(`/app/progress/${BENCH}`);
    await screen.findByRole("img", { name: /^Est\. 1RM, / });
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "History" })).not.toHaveAttribute("aria-current");
  });
});

describe("08.1 AC11 — a Progress list row", () => {
  it("one link per exercise, newest record first, name and headline · date", async () => {
    const { fake } = setup();
    const list = await screen.findByRole("list", { name: "Exercises" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([`/app/progress/${BENCH}`, `/app/progress/${PULL}`]);
    expect(links[0]).toHaveTextContent("Barbell bench press");
    expect(links[0]).toHaveTextContent("Best est. 1RM 122.5 kg · Tue 6 Oct");
    expect(links[1]).toHaveTextContent("Most reps 15 reps · Sun 4 Oct");
    expect(fake.requests.filter((r) => r.path === "/v1/personal-records")).toEqual([expect.objectContaining({ search: "" })]);
  });
});

describe("08.1 AC12 — list states", () => {
  it("empty: text and a link to Workouts", async () => {
    setup({ records: [] });
    expect(await screen.findByText("No records yet — finish a workout to see your progress")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Workouts" })).toHaveAttribute("href", "/app/workouts");
  });

  it.each([
    ["a 500", () => problemResponse(500, "internal")],
    ["a network failure", () => HttpResponse.error()],
  ])("%s → full notice, Try again refetches", async (_l, fail) => {
    const { user } = setup({ fail });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your progress");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Exercises" })).toBeInTheDocument();
  });

  it("an unknown failure is reported with static tags", async () => {
    setup({ fail: () => problemResponse(418, "teapot") });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Request ID: /);
    await waitFor(() =>
      expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "workouts", op: "load-progress-list" }),
    );
  });

  it("signal lost, then Progress opened → the network notice, not an endless spinner (code review #1)", async () => {
    const fake = createWorkoutFake({ records });
    prepareApp({ auth, fake });
    const { router } = renderApp("/app/history");
    await screen.findByRole("heading", { level: 1, name: "History" });
    fake.setOffline(true);
    onlineManager.setOnline(false);
    await router.navigate("/app/progress");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your progress");
  });

  it("a failed refresh keeps the rows", async () => {
    const { fake, queryClient } = setup();
    await screen.findByRole("list", { name: "Exercises" });
    fake.failNext(LIST, () => problemResponse(500, "internal"));
    await queryClient.invalidateQueries({ queryKey: ["records"] });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't refresh your progress");
    expect(within(screen.getByRole("list", { name: "Exercises" })).getAllByRole("link")).toHaveLength(2);
  });
});

describe("08.1 AC24 — list units follow the profile", () => {
  it("lb profile → headline in lb", async () => {
    setup({ unitPreference: "lb" });
    const list = await screen.findByRole("list", { name: "Exercises" });
    expect(within(list).getAllByRole("link")[0]).toHaveTextContent("Best est. 1RM 270.1 lb · Tue 6 Oct");
  });
});
