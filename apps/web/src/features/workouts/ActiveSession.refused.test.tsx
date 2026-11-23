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
import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { finishButton, logButton } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { REFUSED_LEAD, REFUSED_OTHER, refusedBlocked, refusedIncomplete } from "./messages";
import { outboxKey } from "./outbox/outbox";
import { START_CLOCK_MESSAGE } from "./useBeginWorkout";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  scrollIntoView.mockReset();
  cleanupApp();
});

const oneSet: ExerciseSpec[] = [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }];
const FINISH_PATCH = { method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ } as const;
const stored = () => (JSON.parse(localStorageAdapter().get(outboxKey(USER_ID)) ?? '{"ops":[]}') as { ops: { id: string; kind: string; status: string }[] }).ops;
const dialog = () => within(screen.getByRole("dialog", { name: "Finish workout?" }));

async function setup(exercises: ExerciseSpec[] = oneSet) {
  const active = makeWorkoutDetail({ exercises });
  const fake = createWorkoutFake({ active });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, active, ...app };
}
async function tapFinish(user: Awaited<ReturnType<typeof setup>>["user"]) {
  await user.click(finishButton());
  await user.click(dialog().getByRole("button", { name: "Finish" }));
}
const banner = () => screen.findByRole("alert");

describe("06.7 AC19 / AC29 — a refused finish reopens the workout to fix", () => {
  it("a 422 (the end time): the in-progress screen, the lead and the clock message; good sets untouched; Finish works again", async () => {
    const { fake, user } = await setup();
    fake.failNext(FINISH_PATCH, () => problemResponse(422, "validation-error", { errors: [{ path: "endedAt", message: "Before startedAt" }] }));
    await tapFinish(user);
    const alert = await banner();
    expect(alert).toHaveTextContent(REFUSED_LEAD);
    expect(alert).toHaveTextContent(START_CLOCK_MESSAGE);
    expect(alert).toHaveTextContent(/Request ID: /); // code review: support still gets the request id
    expect(screen.getByRole("heading", { name: "Workout" })).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "X" })).getByRole("button", { name: /60 kg × 8/ })).toBeInTheDocument();
    expect(finishButton()).toBeEnabled();
  });

  it("the banner is brought into view when the workout reopens (the panel's own reveal would leave it above the fold)", async () => {
    const { fake, user } = await setup();
    fake.failNext(FINISH_PATCH, () => problemResponse(400, "bad-request"));
    await tapFinish(user);
    const alert = await banner();
    await waitFor(() => expect(scrollIntoView.mock.contexts.some((el) => el instanceof Element && el.contains(alert))).toBe(true));
  });

  it("any other refusal: REFUSED_OTHER with the request id", async () => {
    const { fake, user } = await setup();
    fake.failNext(FINISH_PATCH, () => problemResponse(400, "bad-request"));
    await tapFinish(user);
    const alert = await banner();
    expect(alert).toHaveTextContent(`${REFUSED_LEAD} ${REFUSED_OTHER}`);
    expect(alert).toHaveTextContent(/Request ID: /);
  });

  it("the server's 409 incomplete-working-sets: after a re-read, the set this screen hadn't seen is flagged and shown", async () => {
    const { fake, user } = await setup();
    // Another device logged a working set with no weight; this screen's copy doesn't have it yet.
    const active = fake.state.active!;
    const exercise = active.exercises[0]!;
    const hidden = makeSet({ setNumber: 2, workoutExerciseId: exercise.id, weight: null, weightUnit: null, reps: 8, isComplete: false });
    fake.state.active = { ...active, exercises: [{ ...exercise, sets: [...exercise.sets, hidden] }] };
    fake.failNext(FINISH_PATCH, () => problemResponse(409, "incomplete-working-sets"));
    await tapFinish(user);
    const alert = await banner();
    await waitFor(() => expect(alert).toHaveTextContent(refusedIncomplete(1)));
    const flagged = await within(screen.getByRole("article", { name: "X" })).findByText("Needs data");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(flagged.closest("button")).toHaveTextContent(/– × 8/);
  });

  it("tapping Finish again replaces the refused op and goes through finishOrQueue", async () => {
    const { fake, user, router, active } = await setup();
    fake.failNext(FINISH_PATCH, () => problemResponse(400, "bad-request"));
    await tapFinish(user);
    await banner();
    const refusedId = stored().find((o) => o.kind === "finish")!.id;
    await tapFinish(user);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`));
    expect(stored().some((o) => o.id === refusedId)).toBe(false);
  });

  it("dismissing the banner removes only the refused finish op", async () => {
    const { fake, user } = await setup();
    online = false;
    fake.setOffline(true);
    window.dispatchEvent(new Event("offline"));
    await user.click(logButton("X")); // a queued set the dismiss must keep
    online = true;
    fake.setOffline(false);
    // The set sends, then the finish is refused.
    fake.failNext(FINISH_PATCH, () => problemResponse(400, "bad-request"));
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(stored().filter((o) => o.kind === "create")).toEqual([]));
    await tapFinish(user);
    const alert = await banner();
    await user.click(within(alert).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(REFUSED_LEAD, { exact: false })).toBeNull());
    expect(stored().filter((o) => o.kind === "finish")).toEqual([]);
  });
});

describe("06.7 AC29 — Review Focus 3 and 4: a set refused behind a waiting finish", () => {
  it("the summary routes back to the workout; the banner names the set; discarding it lets Finish work again", async () => {
    const { fake, user, router, active } = await setup();
    // Offline: log a set, then Finish: the summary opens with both waiting.
    online = false;
    fake.setOffline(true);
    window.dispatchEvent(new Event("offline"));
    await user.click(logButton("X"));
    await tapFinish(user);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`));
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });

    // Back online: the server refuses the set, so the finish behind it fails too (blockedBy, AC2).
    online = true;
    fake.setOffline(false);
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(422, "validation-error"));
    window.dispatchEvent(new Event("online"));

    // Review Focus 3: the summary can't stay on a workout that isn't finished.
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
    const alert = await banner();
    expect(alert).toHaveTextContent(`${REFUSED_LEAD} ${refusedBlocked(1, 1)}`);
    expect(finishButton()).toBeDisabled();

    // Review Focus 4: the row has its own Discard; discarding it unlocks Finish.
    const row = within(screen.getByRole("article", { name: "X" }));
    await user.click(row.getByRole("button", { name: /^Discard set / }));
    await waitFor(() => expect(finishButton()).toBeEnabled());
    await tapFinish(user);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`));
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
  });
});

describe("06.7 AC29 — final review: the blocked banner counts sets, not ops", () => {
  async function seeded(ops: (w: { id: string; exercises: { id: string }[] }) => unknown[]) {
    const active = makeWorkoutDetail({ exercises: oneSet });
    const fake = createWorkoutFake({ active });
    prepareApp({ auth, fake });
    localStorageAdapter().set(outboxKey(USER_ID), JSON.stringify({ v: 1, userId: USER_ID, idMap: {}, ops: ops(active) }));
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
  }
  const base = (w: { id: string }, id: string) => ({ id, workoutId: w.id, userId: USER_ID, status: "failed", attempted: true, attempts: 1, nextAttemptAt: 0, enqueuedAt: 0, failure: { status: 422, type: "validation-error", requestId: "r" } });
  const KEY = "30000000-0000-4000-8000-0000000000a1";
  const finishBlockedBy = (w: { id: string; startedAt?: string }, root: string) => ({
    ...base(w, "finish-op"),
    kind: "finish",
    failure: { status: 422, type: "validation-error", requestId: "r", blockedBy: root },
    body: { endedAt: "2026-10-02T11:00:00.000Z" },
    meta: { startedAt: "2026-10-02T10:00:00.000Z", exerciseCount: 1, setCount: 2, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
  });

  it("a set created and then edited, refused together (two ops), reads one set", async () => {
    await seeded((w) => [
      { ...base(w, "c1"), kind: "create", workoutExerciseId: w.exercises[0]!.id, target: { clientGeneratedId: KEY }, body: { clientGeneratedId: KEY, weight: 60, weightUnit: "kg", reps: 5, isComplete: true } },
      { ...base(w, "u1"), kind: "update", workoutExerciseId: w.exercises[0]!.id, target: { clientGeneratedId: KEY }, body: { reps: 6 } },
      finishBlockedBy(w, "c1"),
    ]);
    expect(await banner()).toHaveTextContent(`${REFUSED_LEAD} ${refusedBlocked(1, 1)}`);
  });

  it("a refused note (no set) never says a set couldn't be saved", async () => {
    await seeded((w) => [{ ...base(w, "n1"), kind: "note", workoutExerciseId: w.exercises[0]!.id, body: { notes: "x" } }, finishBlockedBy(w, "n1")]);
    const alert = await banner();
    expect(alert).toHaveTextContent(`${REFUSED_LEAD} ${REFUSED_OTHER}`);
    expect(alert).not.toHaveTextContent(/sets? couldn't be saved/);
  });
});
