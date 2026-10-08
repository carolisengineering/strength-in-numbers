import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { screen, waitFor, within } from "@testing-library/react";
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

import type { WorkoutDetail, WorkoutSummary } from "@sin/core";
import { makePersonalRecord, makeSet, makeWorkoutDetail, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { flattenHistory } from "./queries";

afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

/** Finished workouts on consecutive September days; the last is the newest. */
function finishedWorkouts(count: number, build: (i: number) => WorkoutDetailOptions = () => ({})): WorkoutDetail[] {
  return Array.from({ length: count }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return makeWorkoutDetail({
      startedAt: `2026-09-${day}T10:00:00.000Z`,
      endedAt: `2026-09-${day}T11:00:00.000Z`,
      localDate: `2026-09-${day}`,
      exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ weight: 100, weightKg: 100, reps: 5 })] }],
      ...build(i),
    });
  });
}

function setup(
  finished: WorkoutDetail[],
  options: { unitPreference?: "kg" | "lb"; records?: ReturnType<typeof makePersonalRecord>[] } = {},
) {
  const fake = createWorkoutFake({ finished, records: options.records ?? [] });
  prepareApp({ auth, fake, ...(options.unitPreference ? { unitPreference: options.unitPreference } : {}) });
  return { fake, ...renderApp("/app/history") };
}

const historyGets = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts");
const rows = () => within(screen.getByRole("list", { name: "Finished workouts" })).getAllByRole("link");

describe("08.0 AC9 — paging", () => {
  it("page 1 sends no cursor", async () => {
    const { fake } = setup(finishedWorkouts(2));
    await screen.findByRole("list", { name: "Finished workouts" });
    expect(historyGets(fake)[0]!.search).toBe("?limit=20");
  });

  it("rows are de-duplicated by id, first occurrence wins", () => {
    const a = { id: "a", recordCount: 0 } as WorkoutSummary;
    const b = { id: "b", recordCount: 0 } as WorkoutSummary;
    const b2 = { id: "b", recordCount: 9 } as WorkoutSummary;
    const flat = flattenHistory([
      { items: [a, b], next: "x" },
      { items: [b2], next: null },
    ]);
    expect(flat.map((w) => [w.id, w.recordCount])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });
});

describe("08.0 AC10 — routes and navigation", () => {
  it("/app/history renders History with its nav item current, not coming-soon", async () => {
    setup([]);
    expect(await screen.findByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("coming-soon")).toBeNull();
  });

  it("/app/history/:id highlights History, not Workouts; /app/progress is still coming soon", async () => {
    const [w] = finishedWorkouts(1);
    const { router } = setup([w!]);
    await screen.findByRole("list", { name: "Finished workouts" });
    await router.navigate(`/app/history/${w!.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Workouts" })).not.toHaveAttribute("aria-current");

    await router.navigate("/app/progress");
    expect(await screen.findByTestId("coming-soon")).toBeInTheDocument();
  });

  it("an unfinished id under /app/history still redirects to /app/workouts", async () => {
    const active = makeWorkoutDetail();
    const fake = createWorkoutFake({ active });
    prepareApp({ auth, fake });
    const { router } = renderApp(`/app/history/${active.id}`);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });
});

describe("08.0 AC11 — a history row", () => {
  it("shows date, names with +N, sets and volume; links to /app/history/<id>; never notes or title", async () => {
    const [w] = finishedWorkouts(1, () => ({
      exercises: [
        {
          modality: "weight_reps",
          name: "Bench Press",
          sets: [makeSet({ weight: 100, weightKg: 100, reps: 5 }), makeSet({ setNumber: 2, weight: 100, weightKg: 100, reps: 5 })],
        },
        { modality: "bodyweight_reps", name: "Pull-up" },
        { modality: "weight_reps", name: "Dip" },
        { modality: "weight_reps", name: "Row" },
        { modality: "weight_reps", name: "Curl" },
      ],
    }));
    setup([{ ...w!, notes: "Shoulder felt tight", title: "Push day" }]);

    await screen.findByRole("list", { name: "Finished workouts" });
    const [row] = rows();
    expect(row).toHaveAttribute("href", `/app/history/${w!.id}`);
    expect(row).toHaveTextContent(/^Tue 1 Sept?/);
    expect(row).toHaveTextContent("Bench Press, Pull-up, Dip +2");
    expect(row).toHaveTextContent("2 sets · 1,000 kg");
    expect(screen.queryByText(/Shoulder felt tight/)).toBeNull();
    expect(screen.queryByText(/Push day/)).toBeNull();
  });

  it("omits the volume and its separator when totalVolume is null; 1 set is singular", async () => {
    const [w] = finishedWorkouts(1, () => ({
      exercises: [
        {
          modality: "bodyweight_reps",
          name: "Pull-up",
          sets: [makeSet({ weight: null, weightUnit: null, weightKg: null, reps: 12 })],
        },
      ],
    }));
    setup([w!]);
    await screen.findByRole("list", { name: "Finished workouts" });
    const [row] = rows();
    expect(row).toHaveTextContent(/1 set$/);
    expect(row).not.toHaveTextContent("·");
  });
});

describe("08.0 AC12 — the record badge", () => {
  it("0 → no badge; 1 → '1 personal record'; 2 → '2 personal records'", async () => {
    const ws = finishedWorkouts(3);
    setup(ws, {
      records: [
        makePersonalRecord({ workoutId: ws[1]!.id }),
        makePersonalRecord({ workoutId: ws[2]!.id }),
        makePersonalRecord({ workoutId: ws[2]!.id, recordType: "best_est_1rm" }),
      ],
    });
    await screen.findByRole("list", { name: "Finished workouts" });

    expect(screen.getByRole("img", { name: "2 personal records" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 personal record" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /personal record/ })).toHaveLength(2);
  });
});

describe("08.0 AC13 — Load more, and the end", () => {
  it("appends the next page with the first page's cursor, then disappears at next: null", async () => {
    const { fake, user } = setup(finishedWorkouts(25));
    await screen.findByRole("list", { name: "Finished workouts" });
    expect(rows()).toHaveLength(20);

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(rows()).toHaveLength(25));
    expect(historyGets(fake)[1]!.search).toBe("?limit=20&cursor=fake.20");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("a double tap issues one page-2 request (Review Focus 4)", async () => {
    const { fake, user } = setup(finishedWorkouts(25));
    await screen.findByRole("list", { name: "Finished workouts" });
    await user.dblClick(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(rows()).toHaveLength(25));
    expect(historyGets(fake)).toHaveLength(2);
  });

  it("has no scroll listener or observer (source scan)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(here).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n));
    expect(sources.length).toBeGreaterThan(0);
    for (const f of sources) {
      expect(readFileSync(join(here, f), "utf8")).not.toMatch(/IntersectionObserver|addEventListener\(\s*["']scroll|onScroll/);
    }
  });
});

describe("08.0 AC14 — empty and loading states", () => {
  it("shows the empty state with a link to Workouts and no Load more", async () => {
    setup([]);
    expect(await screen.findByText("No finished workouts yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Workouts" })).toHaveAttribute("href", "/app/workouts");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows the history spinner while page 1 is pending", async () => {
    const gate = deferred<void>();
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    server.use(
      http.get(`${API_BASE_URL}/v1/workouts`, async () => {
        await gate.promise;
        return HttpResponse.json({ items: [], next: null });
      }),
    );
    renderApp("/app/history");

    expect(await screen.findByText("Loading your history…")).toBeInTheDocument();
    gate.resolve();
    expect(await screen.findByText("No finished workouts yet")).toBeInTheDocument();
  });
});

describe("08.0 AC22 — units follow the profile", () => {
  it("volumes render in lb for an lb profile", async () => {
    setup(finishedWorkouts(1), { unitPreference: "lb" });
    await screen.findByRole("list", { name: "Finished workouts" });
    expect(rows()[0]).toHaveTextContent("1 set · 1,102.3 lb");
  });
});
