import { screen, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
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
import { makePersonalRecord, makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 8, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  onlineManager.setOnline(true);
  cleanupApp();
});

const ID = "10000000-0000-4000-8000-0000000000e1";
const NONE = { bestE1rm: null, topSetWeight: null, totalVolume: null, maxReps: null };

function setup(points: ProgressPoint[], records: ReturnType<typeof makePersonalRecord>[]) {
  const fake = createWorkoutFake({ progress: { [ID]: points }, records });
  prepareApp({ auth, fake });
  return { fake, ...renderApp(`/app/progress/${ID}`) };
}
const metricGroup = () => screen.getByRole("group", { name: "Metric" });
const ticks = () => [...document.querySelectorAll("svg text")].map((t) => t.textContent ?? "").filter((t) => /^[\d.,]+$/.test(t));

describe("18.1 AC31 — the chips", () => {
  it("a carry offers Top set and Distance; Distance draws meters", async () => {
    const { user } = setup(
      [makeProgressPoint({ ...NONE, localDate: "2026-09-20", topSetWeight: 24, maxDistance: 12.2 }), makeProgressPoint({ ...NONE, localDate: "2026-10-06", topSetWeight: 32, maxDistance: 12.6 })],
      [makePersonalRecord({ exerciseId: ID, exerciseName: "Farmer Carry", recordType: "max_distance", unit: "m", value: 12.6, previousValue: 12.2 })],
    );
    await screen.findByRole("img", { name: /^Top set,/ });
    expect(within(metricGroup()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Top set", "Distance"]);
    await user.click(within(metricGroup()).getByRole("button", { name: "Distance" }));
    await screen.findByRole("img", { name: /^Distance,/ });
    expect(screen.getByText("Distance (m)")).toBeInTheDocument();
    expect(ticks().some((t) => t.includes("."))).toBe(true);
  });
});

describe("18.1 AC32 — integer ticks for calories and time", () => {
  it("a calories chart over 20–21 cal draws whole-number ticks only", async () => {
    setup(
      [makeProgressPoint({ ...NONE, localDate: "2026-09-20", maxCalories: 20 }), makeProgressPoint({ ...NONE, localDate: "2026-10-06", maxCalories: 21 })],
      [makePersonalRecord({ exerciseId: ID, exerciseName: "Echo Bike", recordType: "max_calories", unit: "cal", value: 21, previousValue: 20 })],
    );
    await screen.findByRole("img", { name: /^Calories,/ });
    expect(within(metricGroup()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Calories"]);
    expect(ticks().length).toBeGreaterThan(0);
    expect(ticks().every((t) => !t.includes("."))).toBe(true);
  });
  it("a hold's Time chart is captioned in seconds, and the readout says it in words", async () => {
    const { user } = setup(
      [makeProgressPoint({ ...NONE, localDate: "2026-09-20", topSetWeight: 20, maxDuration: 75 }), makeProgressPoint({ ...NONE, localDate: "2026-10-06", topSetWeight: 20, maxDuration: 90 })],
      [makePersonalRecord({ exerciseId: ID, exerciseName: "Hold", recordType: "max_duration", unit: "s", value: 90, previousValue: 75 })],
    );
    await screen.findByRole("img", { name: /^Top set,/ });
    await user.click(within(metricGroup()).getByRole("button", { name: "Time" }));
    const img = await screen.findByRole("img", { name: /^Time,/ });
    expect(img.getAttribute("aria-label") ?? img.textContent).toMatch(/1 min 30 s/);
    expect(screen.getByText("Time (seconds)")).toBeInTheDocument();
  });
});
