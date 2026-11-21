import { screen, waitFor, within } from "@testing-library/react";
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
import { http, HttpResponse } from "msw";
import type { WorkoutDetail } from "@sin/core";
import { localStorageAdapter } from "../../storage/storage";
import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { catalog } from "../../test/routineFixtures";
import { makeRoutine, makeRoutineItem, makeSet, makeWorkoutDetail, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { formatStartedAt } from "./format";
import { GONE_BODY, GONE_CONFIRM, GONE_DISCARD, GONE_TITLE, KEEP_OPEN, START_BLOCKED_MESSAGE, WAITING_OFFLINE, WAITING_ONLINE, landedLine, waitingTitle } from "./messages";
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

const STARTED = "2026-10-02T10:00:00.000Z";
const workoutOf = () =>
  makeWorkoutDetail({ startedAt: STARTED, exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 }), makeSet({ setNumber: 2 })] }] });

function finishOp(w: WorkoutDetail, status: "queued" | "failed", failureStatus = 422) {
  return {
    id: "finish-op",
    kind: "finish",
    workoutId: w.id,
    userId: USER_ID,
    status,
    attempted: status === "failed",
    attempts: status === "failed" ? 1 : 0,
    nextAttemptAt: 0,
    enqueuedAt: 0,
    ...(status === "failed" ? { failure: { status: failureStatus, type: "about:blank", requestId: "r-1" } } : {}),
    body: { endedAt: "2026-10-02T11:00:00.000Z" },
    meta: { startedAt: w.startedAt, exerciseCount: 1, setCount: 2, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
  };
}
const storeOps = (ops: unknown[]) => localStorageAdapter().set(outboxKey(USER_ID), JSON.stringify({ v: 1, userId: USER_ID, idMap: {}, ops }));
const storedOps = () => (JSON.parse(localStorageAdapter().get(outboxKey(USER_ID)) ?? '{"ops":[]}') as { ops: unknown[] }).ops;
/** The active read never answers: the card must not wait for it (AC26, AC37). */
const holdActive = () => server.use(http.get(`${API_BASE_URL}/v1/workouts/active`, () => new Promise<Response>(() => {})));

describe("06.7 AC26 — the Workouts screen shows the waiting workout from storage", () => {
  it("offline, with the active read held: the card, its time and counts, View workout, Retry now; no Start", async () => {
    const w = workoutOf();
    const fake = createWorkoutFake({ active: w });
    prepareApp({ auth, fake });
    online = false;
    storeOps([finishOp(w, "queued")]);
    holdActive();
    const { router, user } = renderApp("/app/workouts");

    const card = within(await screen.findByRole("region", { name: waitingTitle(1) }));
    expect(card.getByRole("heading", { name: waitingTitle(1) })).toBeInTheDocument();
    expect(card.getByText(new RegExp(formatStartedAt(STARTED).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    expect(card.getByText(/1 exercise · 2 sets/)).toBeInTheDocument();
    const status = card.getByRole("status");
    expect(status).toHaveTextContent(WAITING_OFFLINE);
    expect(status).not.toHaveTextContent(KEEP_OPEN);
    expect(screen.queryByRole("button", { name: "Start empty workout" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Routines" })).toBeNull();

    await user.click(card.getByRole("button", { name: "View workout" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${w.id}`));
  });

  it("online it says Sending…; Keep this page open when the phone can't keep it; Retry now sends at once", async () => {
    const w = workoutOf();
    const fake = createWorkoutFake({ active: w });
    prepareApp({ auth, fake });
    // The first sends fail at the network: the op backs off and the card stays.
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ }, () => HttpResponse.error(), 1);
    storeOps([finishOp(w, "queued")]);
    holdActive();
    const { user } = renderApp("/app/workouts");
    const card = within(await screen.findByRole("region", { name: waitingTitle(1) }));
    expect(card.getByRole("status")).toHaveTextContent(WAITING_ONLINE);

    // The first send failed at the network and is backing off: Retry now sends it at once.
    await waitFor(() => expect(fake.requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ }, () => HttpResponse.error(), 1);
    await user.click(card.getByRole("button", { name: "Retry now" }));
    await waitFor(() => expect(fake.requests.filter((r) => r.method === "PATCH")).toHaveLength(2));

    // Another tab took the outbox: this one stops saving, so the card says to keep the page open.
    window.dispatchEvent(new StorageEvent("storage", { storageArea: window.localStorage, key: outboxKey(USER_ID), newValue: "{}" }));
    await waitFor(() => expect(card.getByRole("status")).toHaveTextContent(`${WAITING_ONLINE} ${KEEP_OPEN}`));
  });

  it("the card goes when the finish lands, and Start comes back with the one-time line", async () => {
    const w = workoutOf();
    const fake = createWorkoutFake({ active: w });
    prepareApp({ auth, fake });
    online = false;
    storeOps([finishOp(w, "queued")]);
    renderApp("/app/workouts");
    await screen.findByRole("region", { name: waitingTitle(1) });
    online = true;
    window.dispatchEvent(new Event("online"));
    await screen.findByRole("button", { name: "Start empty workout" });
    expect(screen.queryByRole("region", { name: waitingTitle(1) })).toBeNull();
    expect(screen.getByRole("link", { name: /^Your workout saved/ })).toHaveAttribute("href", `/app/workouts/${w.id}`);
  });
});

describe("06.7 AC30 — the gone card", () => {
  it("a 404 refusal shows it at once, even with the active read held; Discard asks, then drops the workout from the phone", async () => {
    const w = workoutOf();
    const fake = createWorkoutFake({ active: null });
    prepareApp({ auth, fake });
    storeOps([finishOp(w, "failed", 404)]);
    holdActive();
    const { user } = renderApp("/app/workouts");
    const card = within(await screen.findByRole("region", { name: GONE_TITLE }));
    expect(card.getByText(GONE_BODY)).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: GONE_DISCARD }));
    const dialog = within(screen.getByRole("dialog", { name: GONE_CONFIRM }));
    await user.click(dialog.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(storedOps()).toEqual([]));
  });

  it("final review: a live tap refused with a 404, then Discard: Start, never the deleted workout as in progress", async () => {
    const w = workoutOf();
    const fake = createWorkoutFake({ active: w });
    prepareApp({ auth, fake });
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    // Deleted on another device: the server no longer has it.
    fake.state.active = null;
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ }, () => problemResponse(404, "not-found"));
    await user.click(screen.getAllByRole("button", { name: "Finish workout" }).at(-1)!);
    await user.click(within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" }));
    const card = within(await screen.findByRole("region", { name: GONE_TITLE }));
    await user.click(card.getByRole("button", { name: GONE_DISCARD }));
    await user.click(within(screen.getByRole("dialog", { name: GONE_CONFIRM })).getByRole("button", { name: "Discard" }));
    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Workout" })).toBeNull();
  });

  it.each([
    ["active is null", () => null],
    ["active is another workout", () => workoutOf()],
  ])("a refused finish whose workout isn't the server's active one (%s) shows the gone card", async (_name, activeOf) => {
    const w = workoutOf();
    const fake = createWorkoutFake({ active: activeOf() });
    prepareApp({ auth, fake });
    storeOps([finishOp(w, "failed", 422)]);
    renderApp("/app/workouts");
    expect(await screen.findByRole("region", { name: GONE_TITLE })).toBeInTheDocument();
  });

  it("code review: a finish blocked by a set write that got a 404 is not gone (the workout is live): it reopens, no discard", async () => {
    const w = workoutOf();
    const fake = createWorkoutFake({ active: w });
    prepareApp({ auth, fake });
    const blocked = { ...finishOp(w, "failed", 404), failure: { status: 404, type: "not-found", requestId: "r-1", blockedBy: "update-1" } };
    storeOps([blocked]);
    holdActive();
    renderApp("/app/workouts");
    // With the active read held, nothing may decide "gone" from the inherited 404 alone.
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole("region", { name: GONE_TITLE })).toBeNull();
  });

  it("a refused finish whose workout is still live is not gone: the workout reopens (AC29), no discard offered", async () => {
    const w = workoutOf();
    const fake = createWorkoutFake({ active: w });
    prepareApp({ auth, fake });
    storeOps([finishOp(w, "failed", 422)]);
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(screen.queryByRole("region", { name: GONE_TITLE })).toBeNull();
    expect(screen.queryByRole("button", { name: GONE_DISCARD })).toBeNull();
  });
});

describe("06.7 AC27 / AC28 — the one-time saved line", () => {
  function landed(items: { workoutId: string; lifts: number | null; how: string }[]) {
    localStorageAdapter().set(LANDED_KEY, JSON.stringify({ v: 1, userId: USER_ID, items }));
  }
  async function startScreen() {
    const fake = createWorkoutFake({ active: null });
    prepareApp({ auth, fake });
    return fake;
  }

  it.each([
    [2, "landed", landedLine(2)],
    [1, "landed", landedLine(1)],
    [0, "landed", "Your workout saved."],
    [null, "ours", "Your workout saved."],
    [null, "elsewhere", "Your workout saved."],
  ])("lifts %s (%s) reads %s, as a link to that summary", async (lifts, how, text) => {
    await startScreen();
    landed([{ workoutId: "w-1", lifts, how }]);
    renderApp("/app/workouts");
    const link = await screen.findByRole("link", { name: text });
    expect(link).toHaveAttribute("href", "/app/workouts/w-1");
  });

  it("Dismiss removes it", async () => {
    await startScreen();
    landed([{ workoutId: "w-1", lifts: 2, how: "landed" }]);
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("link", { name: landedLine(2) });
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("link", { name: landedLine(2) })).toBeNull();
    expect(localStorageAdapter().get(LANDED_KEY)).toBeNull();
  });

  it("minors 636, 668 (final review): starting a workout leaves the line, so a discard doesn't bring it back", async () => {
    await startScreen();
    landed([{ workoutId: "w-1", lifts: 2, how: "landed" }]);
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("link", { name: landedLine(2) });
    await user.click(screen.getByRole("button", { name: "Start empty workout" }));
    await screen.findByRole("heading", { name: "Workout" });
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    await user.click(screen.getByRole("button", { name: "Discard workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Discard this workout?" })).getByRole("button", { name: "Discard" }));
    await screen.findByRole("button", { name: "Start empty workout" });
    expect(screen.queryByRole("link", { name: landedLine(2) })).toBeNull();
    expect(localStorageAdapter().get(LANDED_KEY)).toBeNull();
  });

  it("minors 636, 668 (code review): another device's workout replacing Start leaves the line too", async () => {
    const fake = await startScreen();
    landed([{ workoutId: "w-1", lifts: 2, how: "landed" }]);
    const { user, queryClient } = renderApp("/app/workouts");
    await screen.findByRole("link", { name: landedLine(2) });
    fake.state.active = workoutOf();
    await queryClient.invalidateQueries({ queryKey: ["workouts", "active"] });
    await screen.findByRole("heading", { name: "Workout" });
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    await user.click(screen.getByRole("button", { name: "Discard workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Discard this workout?" })).getByRole("button", { name: "Discard" }));
    await screen.findByRole("button", { name: "Start empty workout" });
    expect(screen.queryByRole("link", { name: landedLine(2) })).toBeNull();
  });

  it("leaving the screen it was shown on removes it", async () => {
    await startScreen();
    landed([{ workoutId: "w-1", lifts: 2, how: "landed" }]);
    const { router } = renderApp("/app/workouts");
    await screen.findByRole("link", { name: landedLine(2) });
    await router.navigate("/app/profile");
    await waitFor(() => expect(localStorageAdapter().get(LANDED_KEY)).toBeNull());
  });
});

describe("06.7 AC18 — a routine's Start says why it waits", () => {
  it("with a finish waiting, the preview's Start sends nothing and shows START_BLOCKED_MESSAGE", async () => {
    const w = workoutOf();
    const routine = makeRoutine({ id: routineId(7), name: "Push A", items: [makeRoutineItem({ exerciseId: catalog[0]!.id })] });
    const fake = createWorkoutFake({ catalog, routines: [routine], active: null });
    prepareApp({ auth, catalog, fake });
    online = false;
    storeOps([finishOp(w, "queued")]);
    const { user } = renderApp(`/app/workouts/routines/${routine.id}`);
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    expect(await screen.findByText(START_BLOCKED_MESSAGE)).toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/workouts")).toEqual([]);
  });
});

describe("06.7 AC18 — code review: the blocked warning doesn't outlive the finish", () => {
  it("Start's 'hasn't sent yet' clears once the finish op is gone", async () => {
    const w = workoutOf();
    const routine = makeRoutine({ id: routineId(8), name: "Pull A", items: [makeRoutineItem({ exerciseId: catalog[0]!.id })] });
    // Finished on another device meanwhile: the replayed finish reconciles as elsewhere, and its op leaves the outbox.
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [routine], active: null, finished: [{ ...w, endedAt: "2026-10-02T10:50:00.000Z" }] }) });
    online = false;
    storeOps([finishOp(w, "queued")]);
    const { user } = renderApp(`/app/workouts/routines/${routine.id}`);
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    expect(await screen.findByText(START_BLOCKED_MESSAGE)).toBeInTheDocument();
    // The finish lands (the op leaves the outbox): the warning goes with it.
    online = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(screen.queryByText(START_BLOCKED_MESSAGE)).toBeNull());
  });
});
