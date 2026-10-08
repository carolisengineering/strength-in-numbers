import { screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { http } from "msw";
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

import type { ProgressPoint } from "@sin/core";
import { API_BASE_URL } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makePersonalRecord, makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 8, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  onlineManager.setOnline(true);
  observability.reportError.mockReset();
  cleanupApp();
});

const ID = "10000000-0000-4000-8000-0000000000b1";
const OTHER = "10000000-0000-4000-8000-0000000000b2";
const SERIES = /^\/v1\/progress\/exercises\//;

const recent: ProgressPoint[] = [
  makeProgressPoint({ localDate: "2026-08-01", bestE1rm: 105, topSetWeight: 90, totalVolume: 900 }),
  makeProgressPoint({ localDate: "2026-09-01", bestE1rm: 115, topSetWeight: 95, totalVolume: 950 }),
  makeProgressPoint({ localDate: "2026-10-06", bestE1rm: 122.5, topSetWeight: 100, totalVolume: 1000 }),
];
const older = makeProgressPoint({ localDate: "2026-01-15", bestE1rm: 95, topSetWeight: 80, totalVolume: 800 });

function setup(
  options: {
    points?: ProgressPoint[];
    records?: ReturnType<typeof makePersonalRecord>[];
    unitPreference?: "kg" | "lb";
    path?: string;
  } = {},
) {
  const fake = createWorkoutFake({
    progress: { [ID]: options.points ?? [older, ...recent], [OTHER]: recent },
    records: options.records ?? [
      makePersonalRecord({ exerciseId: ID, exerciseName: "Barbell bench press", recordType: "best_est_1rm", value: 122.5, previousValue: 115 }),
    ],
  });
  prepareApp({ auth, fake, ...(options.unitPreference ? { unitPreference: options.unitPreference } : {}) });
  return { fake, ...renderApp(options.path ?? `/app/progress/${ID}`) };
}

const seriesGets = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => SERIES.test(r.path));
const chart = () => screen.getByRole("img", { name: /^(Est\. 1RM|Top set|Volume|Reps),/ });
const metricGroup = () => screen.getByRole("group", { name: "Metric" });
const rangeGroup = () => screen.getByRole("group", { name: "Range" });
const sessions = () => within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("button");
const readout = () => document.querySelector("[aria-live='polite']")!;

describe("08.1 AC13 — the exercise screen's frame", () => {
  it("title falls back, then shows the name; Back to Progress; defaults est. 1RM and 3M", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Barbell bench press" })).toBeInTheDocument();
    await screen.findByRole("img", { name: /^Est\. 1RM, 3 months:/ });
    expect(within(metricGroup()).getByRole("button", { name: "Est. 1RM" })).toHaveAttribute("aria-pressed", "true");
    expect(within(rangeGroup()).getByRole("button", { name: "3M" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Back to Progress" })).toHaveAttribute("href", "/app/progress");
  });

  it("no records → the fallback title stays", async () => {
    setup({ records: [] });
    await screen.findByRole("img", { name: /^Est\. 1RM/ });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Exercise progress");
  });
});

describe("08.1 AC14 — the metric control", () => {
  it("offers only metrics with data; the choice survives a range without it", async () => {
    const points = [
      makeProgressPoint({ localDate: "2026-01-10", bestE1rm: null, topSetWeight: 80, totalVolume: null }),
      makeProgressPoint({ localDate: "2026-09-10", bestE1rm: null, topSetWeight: 90, totalVolume: 900 }),
    ];
    const { user } = setup({ points });
    await screen.findByRole("img", { name: /^Top set, 3 months:/ });
    expect(within(metricGroup()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Top set", "Volume"]);
    await user.click(within(metricGroup()).getByRole("button", { name: "Volume" }));
    await screen.findByRole("img", { name: /^Volume, 3 months:/ });
    // 1Y includes January (no volume there) — volume still has data in 1Y, so it stays.
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    await screen.findByRole("img", { name: /^Volume, 1 year:/ });
  });

  it("falls back when the chosen metric has no data in the new range, and restores it on return", async () => {
    // Volume exists only in January: in 1Y it is offered but is NOT the default (est. 1RM is), so
    // seeing it again after 3M proves the choice itself was kept.
    const points = [
      makeProgressPoint({ localDate: "2026-01-10", topSetWeight: 80, bestE1rm: 90, totalVolume: 800 }),
      makeProgressPoint({ localDate: "2026-09-10", topSetWeight: 90, bestE1rm: null, totalVolume: null }),
    ];
    const { user } = setup({ points });
    await screen.findByRole("img", { name: /^Top set, 3 months:/ });
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    await screen.findByRole("img", { name: /^Est\. 1RM, 1 year:/ });
    await user.click(within(metricGroup()).getByRole("button", { name: "Volume" }));
    await screen.findByRole("img", { name: /^Volume, 1 year:/ });
    await user.click(within(rangeGroup()).getByRole("button", { name: "3M" }));
    await screen.findByRole("img", { name: /^Top set, 3 months:/ }); // no 3M volume → default
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    await screen.findByRole("img", { name: /^Volume, 1 year:/ }); // the choice was kept
  });
});

describe("08.1 AC15 — the range chips", () => {
  it("3M / 1Y / All send the right from (fixed clock)", async () => {
    const { fake, user } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    await screen.findByRole("img", { name: /1 year/ });
    await user.click(within(rangeGroup()).getByRole("button", { name: "All" }));
    await screen.findByRole("img", { name: /all time/ });
    expect(seriesGets(fake).map((r) => r.search)).toEqual(["?from=2026-07-08", "?from=2025-10-08", ""]);
  });

  it("while a new range loads the previous chart stays, aria-busy, with a status line", async () => {
    const { user } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    const gate = deferred<void>();
    server.use(http.get(`${API_BASE_URL}/v1/progress/exercises/:id`, async () => { await gate.promise; }, { once: true }));
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    expect(screen.getByRole("img", { name: /3 months/ })).toBeInTheDocument();
    expect(screen.getByText("Loading 1 year…")).toHaveAttribute("role", "status");
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    gate.resolve();
    await screen.findByRole("img", { name: /1 year/ });
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
  });

  it("rapid taps: only the last range is ever shown under its label (Review Focus 1)", async () => {
    const { user } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    await user.click(within(rangeGroup()).getByRole("button", { name: "All" }));
    await screen.findByRole("img", { name: /all time/ });
    expect(within(rangeGroup()).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(sessions()).toHaveLength(4);
  });
});

describe("08.1 AC17 — selection and the readout", () => {
  it("defaults to the newest point; tapping a dot moves the readout and the Open workout link", async () => {
    const { user } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    expect(readout()).toHaveTextContent("Tue 6 Oct 2026 · 122.5 kg");
    const open = screen.getByRole("link", { name: "Open workout" });
    expect(open).toHaveAttribute("href", `/app/history/${recent[2]!.workoutId}`);
    expect(readout().contains(open)).toBe(false);
    await user.click(screen.getAllByTestId("chart-hit")[0]!);
    expect(readout()).toHaveTextContent("Sat 1 Aug 2026 · 105 kg");
    expect(screen.getByRole("link", { name: "Open workout" })).toHaveAttribute("href", `/app/history/${recent[0]!.workoutId}`);
  });

  it("the selection survives a metric switch when the workout has a value", async () => {
    const { user } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    await user.click(screen.getAllByTestId("chart-hit")[0]!);
    await user.click(within(metricGroup()).getByRole("button", { name: "Top set" }));
    expect(readout()).toHaveTextContent("Sat 1 Aug 2026 · 90 kg");
  });
});

describe("08.1 AC18 — the sessions list", () => {
  it("newest first; aria-pressed; a row selects the same point as its dot (keyboard too)", async () => {
    const { user } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    expect(sessions().map((b) => b.textContent)).toEqual([
      "Tue 6 Oct 2026 · 122.5 kg",
      "Tue 1 Sept 2026 · 115 kg",
      "Sat 1 Aug 2026 · 105 kg",
    ]);
    expect(sessions()[0]).toHaveAttribute("aria-pressed", "true");
    sessions()[1]!.focus();
    await user.keyboard("{Enter}");
    expect(sessions()[1]).toHaveAttribute("aria-pressed", "true");
    expect(readout()).toHaveTextContent("Tue 1 Sept 2026 · 115 kg");
    expect(screen.getAllByTestId("chart-dot")[1]).toHaveAttribute("data-selected", "true");
  });

  it("two sessions on the same date are both listed and selectable (Review Focus 2)", async () => {
    const a = makeProgressPoint({ localDate: "2026-09-01", bestE1rm: 100 });
    const b = makeProgressPoint({ localDate: "2026-09-01", bestE1rm: 110 });
    const { user } = setup({ points: [a, b] });
    await screen.findByRole("img", { name: /3 months/ });
    expect(sessions()).toHaveLength(2);
    await user.click(sessions()[1]!);
    expect(readout()).toHaveTextContent("· 100 kg");
  });
});

describe("08.1 AC19 — the exercise's personal records", () => {
  it("shows the lineage's records via RecordsSection", async () => {
    setup();
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByText("Barbell bench press — Best est. 1RM 122.5 kg (was 115 kg)")).toBeInTheDocument();
  });
});

describe("08.1 AC20 — empty and thin ranges", () => {
  it("no points in 3M → range wording; chips usable; no metric control", async () => {
    const { user } = setup({ points: [older] });
    expect(await screen.findByText("No sessions in the last 3 months")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Metric" })).toBeNull();
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    await screen.findByRole("img", { name: /1 year: 1 session/ });
  });

  it("all-null points → nothing to chart", async () => {
    setup({ points: [makeProgressPoint({ localDate: "2026-09-01", bestE1rm: null, topSetWeight: null, totalVolume: null, maxReps: null })] });
    expect(await screen.findByText("Nothing to chart for this exercise yet")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("one point → a dot, no line, one session row", async () => {
    setup({ points: [recent[2]!] });
    await screen.findByRole("img", { name: /1 session/ });
    expect(document.querySelectorAll("polyline")).toHaveLength(0);
    expect(sessions()).toHaveLength(1);
  });
});

describe("08.1 AC21 — series failure", () => {
  it("first load fails → chart-area notice, chips usable, records unaffected; unknown is reported", async () => {
    const fake = createWorkoutFake({ progress: { [ID]: recent }, records: [makePersonalRecord({ exerciseId: ID })] });
    fake.failNext({ method: "GET", path: SERIES }, () => problemResponse(418, "teapot"));
    prepareApp({ auth, fake });
    const { user } = renderApp(`/app/progress/${ID}`);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load this chart");
    expect(await screen.findByRole("region", { name: "Personal records" })).toBeInTheDocument();
    expect(within(rangeGroup()).getByRole("button", { name: "1Y" })).toBeEnabled();
    await waitFor(() =>
      expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "workouts", op: "load-progress-series" }),
    );
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("img", { name: /3 months/ });
  });

  it("a new range failing keeps the previous chart, labelled with its own range", async () => {
    const { fake, user } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    fake.failNext({ method: "GET", path: SERIES }, () => problemResponse(500, "internal"));
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load 1 year");
    expect(screen.getByRole("img", { name: /^Est\. 1RM, 3 months:/ })).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("img", { name: /1 year/ });
  });

  it("offline, a new range is a network failure, never the old chart under the new chip (final review I1)", async () => {
    const { fake, user } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    fake.setOffline(true);
    onlineManager.setOnline(false);
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load 1 year");
    expect(screen.getByRole("img", { name: /^Est\. 1RM, 3 months:/ })).toBeInTheDocument();
    fake.setOffline(false);
    onlineManager.setOnline(true);
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("img", { name: /1 year/ });
  });

  it("Try again after a failed new range shows the loading status, not the stale notice (code review #3)", async () => {
    const { fake, user } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    fake.failNext({ method: "GET", path: SERIES }, () => problemResponse(500, "internal"));
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    const alert = await screen.findByRole("alert");
    const gate = deferred<void>();
    server.use(http.get(`${API_BASE_URL}/v1/progress/exercises/:id`, async () => { await gate.promise; }, { once: true }));
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Loading 1 year…")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.getByRole("img", { name: /^Est\. 1RM, 3 months:/ })).toBeInTheDocument();
    gate.resolve();
    await screen.findByRole("img", { name: /1 year/ });
  });

  it("a failed refresh keeps the chart", async () => {
    const { fake, queryClient } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    fake.failNext({ method: "GET", path: SERIES }, () => problemResponse(500, "internal"));
    await queryClient.invalidateQueries({ queryKey: ["progress"] });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't refresh this chart");
    expect(chart()).toBeInTheDocument();
  });
});

describe("08.1 AC22 — records failure on the exercise screen", () => {
  it("block-local notice; chart unaffected", async () => {
    const fake = createWorkoutFake({ progress: { [ID]: recent }, records: [makePersonalRecord({ exerciseId: ID })] });
    fake.failNext({ method: "GET", path: /^\/v1\/personal-records$/ }, () => problemResponse(500, "internal"));
    prepareApp({ auth, fake });
    renderApp(`/app/progress/${ID}`);
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByRole("alert")).toHaveTextContent("Couldn't load records");
    expect(await screen.findByRole("img", { name: /3 months/ })).toBeInTheDocument();
  });
});

describe("08.1 AC23 — unknown and malformed ids", () => {
  it("404 → NotFound, not reported", async () => {
    setup({ path: "/app/progress/10000000-0000-4000-8000-0000000000ff", records: [] });
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("malformed (encoded) id → 422 → NotFound (Review Focus 5)", async () => {
    const { fake } = setup({ path: "/app/progress/a%2Fb", records: [] });
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    expect(seriesGets(fake)[0]!.path).toBe("/v1/progress/exercises/a%2Fb");
  });
});

describe("08.1 AC24 — units follow the profile", () => {
  it("lb: summary, readout and sessions in lb", async () => {
    setup({ unitPreference: "lb" });
    await screen.findByRole("img", { name: "Est. 1RM, 3 months: 231.5 lb to 270.1 lb, best 270.1 lb" });
    expect(readout()).toHaveTextContent("Tue 6 Oct 2026 · 270.1 lb");
    expect(sessions()[0]).toHaveTextContent("270.1 lb");
    expect(await screen.findByText(/Best est\. 1RM 270\.1 lb/)).toBeInTheDocument();
  });
});

describe("08.1 Review Focus 3 — moving between exercises starts from defaults", () => {
  it("A at 1Y → B shows 3M", async () => {
    const { user, router } = setup();
    await screen.findByRole("img", { name: /3 months/ });
    await user.click(within(rangeGroup()).getByRole("button", { name: "1Y" }));
    await screen.findByRole("img", { name: /1 year/ });
    await router.navigate(`/app/progress/${OTHER}`);
    await screen.findByRole("img", { name: /3 months/ });
    expect(within(rangeGroup()).getByRole("button", { name: "3M" })).toHaveAttribute("aria-pressed", "true");
  });
});
