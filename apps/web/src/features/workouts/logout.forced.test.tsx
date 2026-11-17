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

import { http, HttpResponse } from "msw";
import { onlineManager } from "@tanstack/react-query";
import type { WorkoutDetail } from "@sin/core";
import { logoutAndClear } from "../../auth/logout";
import { localStorageAdapter, resetUserDataWritesForTests } from "../../storage/storage";
import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { waitingTitle } from "./messages";
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

const OTHER_USER = "018f4e8a-1c2d-4f3a-8b6c-0000000000ff";

/** This lifter tapped Finish with no signal; then their session was lost (a forced sign-out) and the page reloaded. */
async function forcedSignOutWithWaitingFinish() {
  const w = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet()] }] });
  const fake = createWorkoutFake({ active: w });
  prepareApp({ auth, fake });
  const op = {
    id: "finish-op",
    kind: "finish",
    workoutId: w.id,
    userId: USER_ID,
    status: "queued",
    attempted: false,
    attempts: 0,
    nextAttemptAt: 0,
    enqueuedAt: 0,
    body: { endedAt: "2026-10-02T11:00:00.000Z" },
    meta: { startedAt: w.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
  };
  localStorageAdapter().set(outboxKey(USER_ID), JSON.stringify({ v: 1, userId: USER_ID, idMap: {}, ops: [op] }));
  logoutAndClear(vi.fn(), localStorageAdapter(), { kind: "forced" });
  resetUserDataWritesForTests(); // the Auth0 redirect reloads the page: the write block goes with it
  return { fake, w };
}

describe("06.7 AC32 — a forced sign-out is invisible to the data", () => {
  it("the file is kept; the same lifter, signed back in, sees the card and the finish sends", async () => {
    const { fake, w } = await forcedSignOutWithWaitingFinish();
    expect(localStorageAdapter().get(outboxKey(USER_ID))).not.toBeNull();
    online = false;
    renderApp("/app/workouts");
    expect(await screen.findByRole("region", { name: waitingTitle(1) })).toBeInTheDocument();
    online = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(fake.requests.some((r) => r.method === "PATCH" && r.path === `/v1/workouts/${w.id}`)).toBe(true));
  });

  it("Review Focus 5: another lifter signing in on the same phone sees no card, and Start works for them", async () => {
    const { fake } = await forcedSignOutWithWaitingFinish();
    fake.state.active = null as unknown as WorkoutDetail | null;
    server.use(
      http.get(`${API_BASE_URL}/v1/me`, () =>
        HttpResponse.json({ id: OTHER_USER, email: "other@example.com", displayName: "Alex", unitPreference: "kg", timezone: "Europe/London", createdAt: "2026-01-01T00:00:00.000Z" }),
      ),
    );
    const { user } = renderApp("/app/workouts");
    await user.click(await screen.findByRole("button", { name: "Start empty workout" }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === "POST" && r.path === "/v1/workouts")).toBe(true));
    expect(screen.queryByRole("region", { name: waitingTitle(1) })).toBeNull();
    // The first lifter's file is untouched; nothing of theirs was sent.
    expect(localStorageAdapter().get(outboxKey(USER_ID))).not.toBeNull();
    expect(fake.requests.some((r) => r.method === "PATCH")).toBe(false);
  });
});
