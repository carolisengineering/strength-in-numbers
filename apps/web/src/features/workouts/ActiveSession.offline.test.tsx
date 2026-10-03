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
import { http, HttpResponse } from "msw";
import { localStorageAdapter } from "../../storage/storage";
import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
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

const failedRow = async () => (await card().findByText("Couldn't save")).closest("li")!;

describe("06.2 AC14 — every set row shows its sync state", () => {
  it("pending rows say 'Not saved yet' and can still be edited; synced rows say nothing", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await logSet(user, "5");
    const pending = card().getByRole("button", { name: /× 5/ });
    expect(pending).toHaveTextContent("Not saved yet");
    expect(card().getByRole("button", { name: /× 8/ })).not.toHaveTextContent("Not saved yet");
    await user.click(pending);
    expect(screen.getByRole("dialog", { name: /Set 2/ })).toBeInTheDocument();
  });

  it("a 422 marks the row 'Couldn't save' with Edit and Discard; Discard removes it", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "weight", message: "Too heavy" }] }),
    );
    await logSet(user, "5");
    const row = await failedRow();
    expect(within(row).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Discard" }));
    expect(card().queryByRole("button", { name: /× 5/ })).not.toBeInTheDocument();
  });

  it("Edit on a 422 row opens the sheet; saving re-queues and the set syncs", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(422, "validation-error"));
    await logSet(user, "5");
    const row = await failedRow();
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const sheet = screen.getByRole("dialog", { name: /Set 2/ });
    await user.type(within(sheet).getByLabelText("Reps"), "{Control>}a{/Control}6");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets.map((s) => s.reps)).toEqual([8, 6]));
    await waitFor(() => expect(card().queryByText("Couldn't save")).not.toBeInTheDocument());
  });
});

describe("06.2 AC15 — the status line", () => {
  it("offline, then saving with Retry now; announced politely; gone once saved", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await logSet(user, "5");
    const line = screen.getByTestId("sync-status");
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).toHaveTextContent("Offline — 1 set will save when you're back online");

    online = true;
    window.dispatchEvent(new Event("online")); // the fake is still offline: the send fails and backs off
    expect(await screen.findByText("Saving 1 set…")).toBeInTheDocument();
    fake.setOffline(false);
    await user.click(screen.getByRole("button", { name: "Retry now" }));
    await waitFor(() => expect(screen.queryByTestId("sync-status")).not.toBeInTheDocument());
  });

  it("a failed set off screen (its exercise is gone) is counted and discardable", async () => {
    const { fake, user } = await setup();
    fake.state.active = { ...fake.state.active!, exercises: [] }; // removed elsewhere; the refetch shows it
    await logSet(user, "5");
    expect(await screen.findByText("1 set couldn't be saved")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("article", { name: "X" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Show" })).not.toBeInTheDocument();
    await user.click(within(screen.getByTestId("sync-status")).getByRole("button", { name: "Discard" }));
    expect(screen.queryByTestId("sync-status")).not.toBeInTheDocument();
  });

  it("a failed set on screen can be shown", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { fake, user } = await setup();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(409, "workout-finished"));
    await logSet(user, "5");
    await failedRow();
    await user.click(within(screen.getByTestId("sync-status")).getByRole("button", { name: "Show" }));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("an offline structure write says so", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await user.click(card().getByRole("button", { name: "Options" }));
    await user.click(screen.getByRole("button", { name: "Remove exercise" }));
    await user.click(within(screen.getByRole("dialog", { name: /Remove X/ })).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("You're offline — try again when you have signal")).toBeInTheDocument();
  });
});

describe("06.2 AC16 — Finish waits for the outbox", () => {
  it("disabled with 'N sets not saved yet' while ops exist; enabled after they sync", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await logSet(user, "5");
    await logSet(user, "6");
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    expect(screen.getByText("2 sets not saved yet")).toBeInTheDocument();
    goOnline(fake);
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled());
    expect(screen.queryByText(/not saved yet/)).not.toBeInTheDocument();
  });
});

describe("06.2 AC17 — ending the workout cleans up", () => {
  it("409 workout-finished on drain fails the row and tracks it; Discard empties the outbox", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(409, "workout-finished"));
    await logSet(user, "5");
    const row = await failedRow();
    expect(observability.track).toHaveBeenCalledWith("set_sync_failed", { status: 409 });
    await user.click(within(row).getByRole("button", { name: "Discard" }));
    expect(JSON.parse(localStorageAdapter().get(OUTBOX_KEY) ?? '{"ops":[]}').ops).toEqual([]);
  });

  it("a refetch that finds no active workout drops that workout's ops", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await logSet(user, "5");
    fake.state.active = null; // finished or deleted elsewhere while offline
    goOnline(fake); // the POST answers 404 ⇒ refetch ⇒ no active workout ⇒ its ops are dropped
    await waitFor(() => expect(localStorageAdapter().get(OUTBOX_KEY)).toBeNull());
  });
});

describe("06.2 AC10 — a sheet opened on a pending set still works after the set synced (final review C1)", () => {
  async function sheetOnPendingThenSync() {
    const ctx = await setup();
    goOffline(ctx.fake);
    await logSet(ctx.user, "5");
    await ctx.user.click(card().getByRole("button", { name: /× 5/ }));
    screen.getByRole("dialog", { name: /Set 2/ });
    goOnline(ctx.fake);
    await waitFor(() => expect(ctx.fake.state.active!.exercises[0]!.sets).toHaveLength(2));
    await waitFor(() => expect(card().getByRole("button", { name: /× 5/ })).not.toHaveTextContent("Not saved yet"));
    return ctx;
  }

  it("Save edits the synced set on the server (by its server id)", async () => {
    const { fake, user } = await sheetOnPendingThenSync();
    const sheet = screen.getByRole("dialog", { name: /Set 2/ });
    await user.type(within(sheet).getByLabelText("Reps"), "{Control>}a{/Control}6");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets.map((s) => s.reps)).toEqual([8, 6]));
    expect(screen.queryByText(/out of date/)).not.toBeInTheDocument();
  });

  it("Delete removes the synced set on the server and on screen", async () => {
    const { fake, user } = await sheetOnPendingThenSync();
    await user.click(within(screen.getByRole("dialog", { name: /Set 2/ })).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets).toHaveLength(1));
    expect(card().queryByRole("button", { name: /× 5/ })).not.toBeInTheDocument();
  });
});

describe("06.2 AC12 — a stale /active read that lands after a sync does not hide the set (final review I1)", () => {
  it("the synced row survives a read whose snapshot predates the POST", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await logSet(user, "5");

    // Back online for TanStack only (no window event, so the outbox does not drain yet).
    online = true;
    fake.setOffline(false);
    onlineManager.setOnline(true);
    const gate = deferred<void>();
    server.use(
      http.get(
        `${API_BASE_URL}/v1/workouts/active`,
        async () => {
          const snapshot = structuredClone(fake.state.active); // before the POST lands
          await gate.promise;
          return HttpResponse.json(snapshot);
        },
        { once: true },
      ),
    );
    focusManager.setFocused(false);
    focusManager.setFocused(true); // the read starts and is held

    await waitFor(() => expect(activeReads(fake)).toBeGreaterThan(0)); // the held read has started
    window.dispatchEvent(new Event("online")); // now the outbox drains: the create syncs
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets).toHaveLength(2));
    gate.resolve();
    await new Promise((r) => setTimeout(r, 50));

    expect(card().getAllByRole("button", { name: /× 5/ })).toHaveLength(1);
    focusManager.setFocused(undefined);
  });
});

describe("06.2 AC19 — the tab conflict notice", () => {
  it("shows the reload notice when another tab writes the outbox", async () => {
    await setup();
    window.dispatchEvent(new StorageEvent("storage", { key: OUTBOX_KEY, newValue: "{}", storageArea: window.localStorage }));
    expect(await screen.findByText("This workout is open in another tab. Reload to continue here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
