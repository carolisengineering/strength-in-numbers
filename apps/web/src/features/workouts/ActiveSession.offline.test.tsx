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

import { focusManager, onlineManager } from "@tanstack/react-query";
import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { OUTBOX_KEY } from "./outbox/outbox";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

afterEach(() => {
  online = true;
  // TanStack's onlineManager is a module singleton: an `offline` event in one test would pause the next.
  onlineManager.setOnline(true);
  observability.track.mockReset();
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;

async function setup(sets = [makeSet({ setNumber: 1, weight: 60, reps: 8 })]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", sets }] }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const card = () => within(screen.getByRole("article", { name: "X" }));
const setPosts = (fake: Fake) => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));
const activeReads = (fake: Fake) =>
  fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;
async function logSet(user: Awaited<ReturnType<typeof setup>>["user"], reps: string) {
  const field = card().getByLabelText("Reps");
  await user.clear(field);
  await user.type(field, reps);
  await user.click(card().getByRole("button", { name: "Log set" }));
}
function goOffline(fake: Fake) {
  online = false;
  fake.setOffline(true);
  window.dispatchEvent(new Event("offline"));
}
function goOnline(fake: Fake) {
  online = true;
  fake.setOffline(false);
  window.dispatchEvent(new Event("online"));
}

describe("06.2 AC11 — logging works with the browser offline", () => {
  it("three sets logged offline show at once, numbered 2–4, and nothing is sent", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await logSet(user, "5");
    await logSet(user, "6");
    await logSet(user, "7");
    const rows = card().getAllByRole("button", { name: /^\d/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^1/),
      expect.stringMatching(/^2.*× 5/),
      expect.stringMatching(/^3.*× 6/),
      expect.stringMatching(/^4.*× 7/),
    ]);
    expect(setPosts(fake)).toHaveLength(0);
  });
});

describe("06.2 AC12 — a synced op updates the cache in place", () => {
  it("going online sends the sets in order; rows keep their places; no duplicate", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await logSet(user, "5");
    await logSet(user, "6");
    goOnline(fake);
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets).toHaveLength(3));
    await waitFor(() => expect(card().getAllByRole("button", { name: /^\d/ })).toHaveLength(3));
    expect(setPosts(fake).map((r) => (r.body as { reps: number }).reps)).toEqual([5, 6]);
  });

  it("a focus refetch while a set is pending keeps the row, once", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await logSet(user, "5");
    // Back online (TanStack resumes on the event), but the send keeps failing, so the set stays pending.
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => new Response(null, { status: 503 }), 5);
    goOnline(fake);
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    const before = activeReads(fake);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(activeReads(fake)).toBeGreaterThan(before));
    expect(card().getAllByRole("button", { name: /× 5/ })).toHaveLength(1);
    focusManager.setFocused(undefined);
  });
});

describe("06.2 AC13 — a reloaded tab keeps its queue", () => {
  it("ops in storage are overlaid after sign-in and drained; a create that already landed shows once", async () => {
    const landedKey = "30000000-0000-4000-8000-0000000000aa";
    const pendingKey = "30000000-0000-4000-8000-0000000000bb";
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({
        exercises: [
          {
            modality: "weight_reps",
            name: "X",
            sets: [makeSet({ setNumber: 1 }), makeSet({ setNumber: 2, reps: 4, clientGeneratedId: landedKey })],
          },
        ],
      }),
    });
    prepareApp({ auth, fake });
    const w = fake.state.active!;
    const we = w.exercises[0]!;
    const op = (key: string, reps: number, attempted: boolean) => ({
      id: `op-${key}`,
      kind: "create",
      workoutId: w.id,
      workoutExerciseId: we.id,
      userId: USER_ID,
      status: "queued",
      attempted,
      attempts: attempted ? 1 : 0,
      nextAttemptAt: 0,
      enqueuedAt: Date.now(),
      target: { clientGeneratedId: key },
      body: { clientGeneratedId: key, weight: 60, weightUnit: "kg", reps, isComplete: true },
    });
    localStorageAdapter().set(
      OUTBOX_KEY,
      JSON.stringify({ v: 1, userId: USER_ID, ops: [op(landedKey, 4, true), op(pendingKey, 9, false)], idMap: {} }),
    );

    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets).toHaveLength(3));
    expect(card().getAllByRole("button", { name: /× 4/ })).toHaveLength(1);
    expect(card().getAllByRole("button", { name: /× 9/ })).toHaveLength(1);
    // Drained: no ops left (the id map keeps the key → server id entry on purpose, Review Focus 1).
    await waitFor(() => expect(JSON.parse(localStorageAdapter().get(OUTBOX_KEY) ?? '{"ops":[]}').ops).toEqual([]));
  });
});
