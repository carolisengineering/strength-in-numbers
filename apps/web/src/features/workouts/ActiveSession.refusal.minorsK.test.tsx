import { screen, waitFor } from "@testing-library/react";
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

import { localStorageAdapter } from "../../storage/storage";
import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { REFUSED_LEAD, REFUSED_OTHER, finishLocked, refusedBlocked, refusedIncomplete } from "./messages";
import { outboxKey } from "./outbox/outbox";

const scrollIntoView = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  scrollIntoView.mockReset();
  cleanupApp();
});

const oneSet: ExerciseSpec[] = [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }];
const KEY = "30000000-0000-4000-8000-0000000000a1";
const KEY2 = "30000000-0000-4000-8000-0000000000a2";
type W = { id: string; exercises: { id: string }[] };
const base = (w: W, id: string) => ({ id, workoutId: w.id, userId: USER_ID, status: "failed", attempted: true, attempts: 1, nextAttemptAt: 0, enqueuedAt: 0, failure: { status: 422, type: "validation-error", requestId: "r" } });
const finishOp = (w: W, id: string, failure: Record<string, unknown>) => ({
  ...base(w, id),
  kind: "finish",
  failure: { requestId: "r", ...failure },
  body: { endedAt: "2026-10-02T11:00:00.000Z" },
  meta: { startedAt: "2026-10-02T10:00:00.000Z", exerciseCount: 1, setCount: 2, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
});
const createOp = (w: W, id: string, key: string) => ({ ...base(w, id), kind: "create", workoutExerciseId: w.exercises[0]!.id, target: { clientGeneratedId: key }, body: { clientGeneratedId: key, weight: 60, weightUnit: "kg", reps: 5, isComplete: true } });
const updateOp = (w: W, id: string, key: string) => ({ ...base(w, id), kind: "update", workoutExerciseId: w.exercises[0]!.id, target: { clientGeneratedId: key }, body: { reps: 6 } });

function seeded(ops: (w: W) => unknown[], active = makeWorkoutDetail({ exercises: oneSet })) {
  const fake = createWorkoutFake({ active });
  prepareApp({ auth, fake });
  localStorageAdapter().set(outboxKey(USER_ID), JSON.stringify({ v: 1, userId: USER_ID, idMap: {}, ops: ops(active) }));
  return { fake, active };
}
const statusLine = () => document.querySelector("[data-session-status]");
/** How many times the refused banner was scrolled into view. */
const bannerScrolls = () => scrollIntoView.mock.contexts.filter((el) => el instanceof Element && (el.textContent ?? "").includes(REFUSED_LEAD)).length;

describe("06.7 AC21 — minor 642: the status line counts refused rows", () => {
  it("a set whose create and edit were both refused: the banner and the line both say one", async () => {
    seeded((w) => [createOp(w, "c1", KEY), updateOp(w, "u1", KEY), finishOp(w, "f-642", { status: 422, type: "validation-error", blockedBy: "c1" })]);
    renderApp("/app/workouts");
    expect(await screen.findByRole("alert")).toHaveTextContent(`${REFUSED_LEAD} ${refusedBlocked(1)}`);
    await waitFor(() => expect(statusLine()).toHaveTextContent(finishLocked(1)));
  });

  it("Review Focus 4: two refused sets and a refused note read three things; the banner says two sets", async () => {
    seeded((w) => [
      createOp(w, "c1", KEY),
      updateOp(w, "u1", KEY),
      createOp(w, "c2", KEY2),
      { ...base(w, "n1"), kind: "note", workoutExerciseId: w.exercises[0]!.id, body: { notes: "x" } },
      finishOp(w, "f-642b", { status: 422, type: "validation-error", blockedBy: "c1" }),
    ]);
    renderApp("/app/workouts");
    expect(await screen.findByRole("alert")).toHaveTextContent(refusedBlocked(2));
    await waitFor(() => expect(statusLine()).toHaveTextContent(finishLocked(3)));
  });
});

describe("minor 637 — the refused banner scrolls into view once per refused op", () => {
  it("leaving the workout and coming back doesn't scroll to the banner again", async () => {
    seeded((w) => [finishOp(w, "f-637", { status: 400, type: "bad-request" })]);
    const { router } = renderApp("/app/workouts");
    await screen.findByRole("alert");
    await waitFor(() => expect(bannerScrolls()).toBe(1));
    await router.navigate("/app/history");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await router.navigate("/app/workouts");
    await screen.findByRole("alert");
    // Let the reveal effects run; the banner's own scroll must not come back.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Workout" })).toBeInTheDocument());
    expect(bannerScrolls()).toBe(1);
  });

  it("a different refused op scrolls again", async () => {
    seeded((w) => [finishOp(w, "f-637-other", { status: 400, type: "bad-request" })]);
    renderApp("/app/workouts");
    await screen.findByRole("alert");
    await waitFor(() => expect(bannerScrolls()).toBe(1));
  });
});

describe("minor 638 — an incomplete refusal shows the lead alone until its re-read lands", () => {
  it("no REFUSED_OTHER flash: the lead alone, then the count", async () => {
    const { fake, active } = seeded((w) => [finishOp(w, "f-638", { status: 409, type: "incomplete-working-sets" })]);
    // The re-read sees a working set with no weight that this screen doesn't have yet.
    const exercise = active.exercises[0]!;
    const hidden = makeSet({ setNumber: 2, workoutExerciseId: exercise.id, weight: null, weightUnit: null, reps: 8, isComplete: false });
    fake.state.active = { ...active, exercises: [{ ...exercise, sets: [...exercise.sets, hidden] }] };
    const gate = deferred<void>();
    let reads = 0;
    // The first read (the screen's own) goes through; later ones wait for the gate, then fall through to the fake.
    server.use(
      http.get(`${API_BASE_URL}/v1/workouts/active`, async () => {
        reads += 1;
        if (reads > 1) await gate.promise;
        return undefined;
      }),
    );
    renderApp("/app/workouts");
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    expect(alert).toHaveTextContent(REFUSED_LEAD);
    expect(alert).not.toHaveTextContent(REFUSED_OTHER);
    gate.resolve();
    await waitFor(() => expect(alert).toHaveTextContent(`${REFUSED_LEAD} ${refusedIncomplete(1)}`));
  });
});
