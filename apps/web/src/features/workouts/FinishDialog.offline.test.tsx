import { screen, within } from "@testing-library/react";
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
import type { PlannedSet, WorkoutDetail } from "@sin/core";
import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { FINISH_OFFLINE_NOTE, finishUnsentNote } from "./messages";
import { outboxKey } from "./outbox/outbox";
import type { OutboxOp } from "./outbox/ops";

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

const planned: PlannedSet = { setType: "working", repsLow: 8, repsHigh: 8, weight: 60, weightUnit: "kg" };
const workoutOf = () =>
  makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", plannedSets: [planned, planned, planned, planned, planned, planned], sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }] });
const key = (n: number) => `30000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const queuedCreate = (w: WorkoutDetail, n: number): OutboxOp =>
  ({
    id: `create-${n}`,
    workoutId: w.id,
    userId: USER_ID,
    status: "queued",
    attempted: false,
    attempts: 0,
    nextAttemptAt: Date.now() + 60_000, // waiting out a backoff: it stays queued while the dialog is open
    enqueuedAt: 0,
    kind: "create",
    workoutExerciseId: w.exercises[0]!.id,
    target: { clientGeneratedId: key(n) },
    body: { clientGeneratedId: key(n), weight: 60, weightUnit: "kg", reps: 8, isComplete: true },
  }) as OutboxOp;

async function setup({ offline, unsent }: { offline: boolean; unsent: number }) {
  const active = workoutOf();
  const fake = createWorkoutFake({ active });
  prepareApp({ auth, fake });
  const ops = Array.from({ length: unsent }, (_, i) => queuedCreate(active, i + 1));
  localStorageAdapter().set(outboxKey(USER_ID), JSON.stringify({ v: 1, userId: USER_ID, idMap: {}, ops }));
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  if (offline) {
    online = false;
    fake.setOffline(true);
    window.dispatchEvent(new Event("offline"));
  }
  return app;
}

async function openFinish(user: Awaited<ReturnType<typeof setup>>["user"]) {
  await user.click(screen.getByRole("button", { name: "Workout menu" }));
  // Planned sets are left, so the menu's item is End workout early; the list end's free-form Finish isn't drawn.
  return user;
}
const endEarlyDialog = async (user: Awaited<ReturnType<typeof setup>>["user"]) => {
  await openFinish(user);
  await user.click(screen.getByRole("button", { name: "End workout early" }));
  return within(screen.getByRole("dialog", { name: "End workout early?" }));
};

describe("06.7 AC22 — the Finish dialogs say what will happen", () => {
  it("offline: End workout early's dialog says the workout is saved on the phone and sends later", async () => {
    const { user } = await setup({ offline: true, unsent: 0 });
    const dialog = await endEarlyDialog(user);
    expect(dialog.getByText(FINISH_OFFLINE_NOTE)).toBeInTheDocument();
    // 17.2's content is unchanged.
    expect(dialog.getByText("Unlogged sets aren't saved.")).toBeInTheDocument();
  });

  it("online with unsent sets: the dialog says they send first, counted", async () => {
    const { user } = await setup({ offline: false, unsent: 2 });
    const dialog = await endEarlyDialog(user);
    expect(dialog.getByText(finishUnsentNote(2))).toBeInTheDocument();
    expect(dialog.queryByText(FINISH_OFFLINE_NOTE)).toBeNull();
  });

  it("offline with unsent sets: the offline note says it all (one note)", async () => {
    const { user } = await setup({ offline: true, unsent: 1 });
    const dialog = await endEarlyDialog(user);
    expect(dialog.getByText(FINISH_OFFLINE_NOTE)).toBeInTheDocument();
    expect(dialog.queryByText(finishUnsentNote(1))).toBeNull();
  });

  it("online with nothing unsent: no note", async () => {
    const { user } = await setup({ offline: false, unsent: 0 });
    const dialog = await endEarlyDialog(user);
    expect(dialog.queryByText(FINISH_OFFLINE_NOTE)).toBeNull();
    expect(dialog.queryByText(/haven't sent yet|hasn't sent yet/)).toBeNull();
  });
});

describe("06.7 AC22 — the plain Finish dialog says the same", () => {
  const noPlan = () => makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }] });

  it.each([
    [true, 0, FINISH_OFFLINE_NOTE],
    [false, 1, finishUnsentNote(1)],
  ])("offline %s, %i unsent: the Finish dialog shows its note", async (offline, unsent, text) => {
    const active = noPlan();
    const fake = createWorkoutFake({ active });
    prepareApp({ auth, fake });
    localStorageAdapter().set(outboxKey(USER_ID), JSON.stringify({ v: 1, userId: USER_ID, idMap: {}, ops: Array.from({ length: unsent }, (_, i) => queuedCreate(active, i + 1)) }));
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    if (offline) {
      online = false;
      fake.setOffline(true);
      window.dispatchEvent(new Event("offline"));
    }
    await user.click(screen.getAllByRole("button", { name: "Finish workout" }).at(-1)!);
    const dialog = within(screen.getByRole("dialog", { name: "Finish workout?" }));
    expect(dialog.getByText(text)).toBeInTheDocument();
  });
});
