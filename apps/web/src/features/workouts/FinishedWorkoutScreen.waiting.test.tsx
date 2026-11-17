import { screen, waitFor } from "@testing-library/react";
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

import { onlineManager } from "@tanstack/react-query";
import { HttpResponse } from "msw";
import type { WorkoutDetail } from "@sin/core";
import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { EDIT_AFTER_SEND, NOT_DURABLE, SAVED_ELSEWHERE, SAVED_OFFLINE, SAVED_SLOW, SENT } from "./messages";
import { LANDED_KEY } from "./outbox/landedStore";
import { outboxKey } from "./outbox/outbox";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  cleanupApp();
});

const ENDED = "2026-10-02T11:00:00.000Z";

/** The server still has the workout live; this phone holds its finish op (saved at the tap, not yet sent). */
function seed({ offline }: { offline: boolean }) {
  const active = makeWorkoutDetail({
    startedAt: "2026-10-02T10:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1, weight: 100, reps: 5, completedAt: "2026-10-02T10:10:00.000Z" })] }],
  });
  const record = makePersonalRecord({ workoutId: active.id, exerciseName: "Bench" });
  const fake = createWorkoutFake({ active, newRecordsOnFinish: [record] });
  prepareApp({ auth, fake });
  online = !offline;
  localStorageAdapter().set(
    outboxKey(USER_ID),
    JSON.stringify({
      v: 1,
      userId: USER_ID,
      idMap: {},
      ops: [
        {
          id: "finish-op",
          kind: "finish",
          workoutId: active.id,
          userId: USER_ID,
          status: "queued",
          attempted: false,
          attempts: 0,
          nextAttemptAt: 0,
          enqueuedAt: 0,
          body: { endedAt: ENDED },
          meta: { startedAt: active.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
        },
      ],
    }),
  );
  return { fake, active };
}

const message = () => screen.getByTestId("finish-saved");
const goOnline = () => {
  online = true;
  window.dispatchEvent(new Event("online"));
};

describe("06.7 AC23 — the summary says the workout is saved on this phone", () => {
  it("offline, from the tap (saved: offline): the stats and sets, and SAVED_OFFLINE in a polite status region", async () => {
    const { active } = seed({ offline: true });
    renderApp(`/app/workouts/${active.id}`, { saved: "offline" });
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(message()).toHaveAttribute("role", "status");
    expect(message()).toHaveTextContent(SAVED_OFFLINE);
    expect(screen.getByText("100 kg × 5")).toBeInTheDocument();
  });

  it("slow (saved: slow): SAVED_SLOW", async () => {
    const { active, fake } = seed({ offline: false });
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ }, () => HttpResponse.error(), 5);
    renderApp(`/app/workouts/${active.id}`, { saved: "slow" });
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(message()).toHaveTextContent(SAVED_SLOW);
  });

  it("Review Focus 2 — a reload with signal (no router state) is worded for online, never blank", async () => {
    const { active, fake } = seed({ offline: false });
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ }, () => HttpResponse.error(), 5);
    renderApp(`/app/workouts/${active.id}`);
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(message()).toHaveTextContent(SAVED_SLOW);
  });

  it("a reload with no signal: SAVED_OFFLINE", async () => {
    const { active } = seed({ offline: true });
    renderApp(`/app/workouts/${active.id}`);
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(message()).toHaveTextContent(SAVED_OFFLINE);
  });

  it("NOT_DURABLE when the phone can't keep it (another tab took the outbox: durable false), re-evaluated live", async () => {
    const { active } = seed({ offline: true });
    renderApp(`/app/workouts/${active.id}`, { saved: "offline" });
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(message()).toHaveTextContent(SAVED_OFFLINE);
    window.dispatchEvent(new StorageEvent("storage", { storageArea: window.localStorage, key: outboxKey(USER_ID), newValue: JSON.stringify({ v: 1, userId: USER_ID, idMap: {}, ops: [] }) }));
    await waitFor(() => expect(message()).toHaveTextContent(NOT_DURABLE));
  });
});

describe("06.7 AC24 — the summary has a waiting state", () => {
  it("no records, no Workout menu (the edit line in its place), no Hevy section", async () => {
    const { active } = seed({ offline: true });
    const { queryClient } = renderApp(`/app/workouts/${active.id}`, { saved: "offline" });
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(screen.queryByRole("region", { name: /record/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Workout menu" })).toBeNull();
    expect(screen.getByText(EDIT_AFTER_SEND)).toBeInTheDocument();
    expect(queryClient.getQueryCache().find({ queryKey: ["hevy", "link", active.id] })).toBeUndefined();
  });

  it.each(["workouts", "history"])("/app/%s/:id/edit redirects to the summary while it waits", async (section) => {
    const { active } = seed({ offline: true });
    const { router } = renderApp(`/app/${section}/${active.id}/edit`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/${section}/${active.id}`));
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
  });
});

describe("06.7 AC25 / AC28 — landing while the summary is open updates it in place", () => {
  it("landed: SENT replaces the message in the same region, the record ledger appears, the Workout menu and Hevy return, no navigation", async () => {
    const { active } = seed({ offline: true });
    const { router, queryClient, user } = renderApp(`/app/workouts/${active.id}`, { saved: "offline" });
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    const region = message();
    goOnline();
    await waitFor(() => expect(message()).toHaveTextContent(SENT));
    expect(message()).toBe(region);
    expect(await screen.findByRole("region", { name: /record/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    expect(screen.getByRole("button", { name: "Edit workout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete workout" })).toBeInTheDocument();
    expect(screen.queryByText(EDIT_AFTER_SEND)).toBeNull();
    expect(queryClient.getQueryCache().find({ queryKey: ["hevy", "link", active.id] })).toBeDefined();
    expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`);
  });

  it("ours (a lost reply): SENT, and the records are fetched by workout id", async () => {
    const { active, fake } = seed({ offline: true });
    renderApp(`/app/workouts/${active.id}`, { saved: "offline" });
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    fake.loseNextResponse({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ });
    goOnline();
    await waitFor(() => expect(message()).toHaveTextContent(SENT), { timeout: 4000 });
    await screen.findByRole("region", { name: /record/i });
    expect(fake.requests.some((r) => r.method === "GET" && r.path === "/v1/personal-records" && r.search === `?workoutId=${active.id}`)).toBe(true);
  });

  it("elsewhere: SAVED_ELSEWHERE", async () => {
    const { active, fake } = seed({ offline: true });
    renderApp(`/app/workouts/${active.id}`, { saved: "offline" });
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ }, () => problemResponse(409, "workout-finished"));
    fake.state.finished.set(active.id, { ...fake.state.active!, endedAt: "2026-10-02T10:50:00.000Z" } as WorkoutDetail);
    fake.state.active = null;
    goOnline();
    await waitFor(() => expect(message()).toHaveTextContent(SAVED_ELSEWHERE));
  });
});

describe("06.7 AC27 — the summary and the one-time line", () => {
  it("a landing while the summary is open writes no landed entry", async () => {
    const { active } = seed({ offline: true });
    renderApp(`/app/workouts/${active.id}`, { saved: "offline" });
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    goOnline();
    await waitFor(() => expect(message()).toHaveTextContent(SENT));
    expect(localStorageAdapter().get(LANDED_KEY)).toBeNull();
  });

  it("opening a summary removes its landed entry", async () => {
    const finished = makeWorkoutDetail({ endedAt: ENDED, exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet()] }] });
    const fake = createWorkoutFake({ finished: [finished] });
    prepareApp({ auth, fake });
    localStorageAdapter().set(LANDED_KEY, JSON.stringify({ v: 1, userId: USER_ID, items: [{ workoutId: finished.id, lifts: 1, how: "landed" }, { workoutId: "other", lifts: null, how: "ours" }] }));
    renderApp(`/app/history/${finished.id}`);
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    await waitFor(() =>
      expect(JSON.parse(localStorageAdapter().get(LANDED_KEY)!)).toMatchObject({ items: [{ workoutId: "other" }] }),
    );
  });
});
