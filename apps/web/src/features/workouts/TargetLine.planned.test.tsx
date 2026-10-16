import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlannedSet } from "@sin/core";

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

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

const p = (weight: number | null, unit: "kg" | "lb" = "kg"): PlannedSet => ({ setType: "working", repsLow: 8, repsHigh: 8, weight, weightUnit: weight === null ? null : unit });

const ramp = (o: Record<string, unknown> = {}) => ({
  modality: "weight_reps" as const,
  name: "Bench",
  targetSets: 3, targetRepsLow: 6, targetRepsHigh: 10, targetRpe: 8,
  plannedSets: [p(60), p(80), p(100)],
  sets: [makeSet({ setNumber: 1, weight: 60, reps: 10 })],
  ...o,
});

describe("10.2 AC29 — the active card", () => {
  it("shows the weighted target line under the name", async () => {
    const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises: [ramp()] }) });
    prepareApp({ auth, fake });
    renderApp("/app/workouts");
    const card = await screen.findByRole("article", { name: /^Bench/ });
    expect(within(card).getByText("3 × 6–10 @ 60–100 kg")).toBeInTheDocument();
    expect(within(card).queryByText(/RPE/)).toBeNull(); // the fixture has targetRpe 8: stored, never shown (17.1 AC4)
  });
});

describe("10.2 AC30 — the finished workout shows the weight too, at both routes", () => {
  const finished = () => makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises: [ramp()] });
  it.each([
    ["the summary", (id: string) => `/app/workouts/${id}`],
    ["the History detail", (id: string) => `/app/history/${id}`],
  ])("%s", async (_name, path) => {
    const detail = finished();
    prepareApp({ auth, fake: createWorkoutFake({ finished: [detail] }) });
    renderApp(path(detail.id));
    expect(await screen.findByText("3 × 6–10 @ 60–100 kg")).toBeInTheDocument();
    expect(screen.queryByText(/RPE/)).toBeNull();
    expect(screen.queryByText(/planned|of 3/i)).toBeNull(); // no planned-versus-logged comparison
  });
  it("an item with no planned weights renders exactly as in 10.1", async () => {
    const detail = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises: [ramp({ plannedSets: [] })] });
    prepareApp({ auth, fake: createWorkoutFake({ finished: [detail] }) });
    renderApp(`/app/workouts/${detail.id}`);
    expect(await screen.findByText("3 × 6–10")).toBeInTheDocument();
    expect(screen.queryByText(/RPE/)).toBeNull();
  });
  it("the History LIST row shows no target line", async () => {
    const detail = finished();
    prepareApp({ auth, fake: createWorkoutFake({ finished: [detail] }) });
    renderApp("/app/history");
    await screen.findByRole("link", { name: /Bench/ });
    expect(screen.queryByText(/@ 60/)).toBeNull();
  });
});
