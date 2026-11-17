import { screen } from "@testing-library/react";
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
import type { WorkoutDetail } from "@sin/core";
import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { outboxKey } from "./outbox/outbox";
import { failedOpCount, type OutboxOp } from "./outbox/ops";

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

const workoutOf = () =>
  makeWorkoutDetail({
    exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }],
    sections: [{ name: "Finisher", timer: { format: "amrap", capSeconds: 600 } }],
  });

const base = (w: WorkoutDetail, id: string, status: "queued" | "failed") => ({
  id,
  workoutId: w.id,
  userId: USER_ID,
  status,
  attempted: status === "failed",
  attempts: status === "failed" ? 1 : 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
  ...(status === "failed" ? { failure: { status: 422, type: "about:blank", requestId: "r" } } : {}),
});
const key = (n: number) => `30000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const create = (w: WorkoutDetail, n: number, status: "queued" | "failed"): OutboxOp =>
  ({ ...base(w, `create-${n}`, status), kind: "create", workoutExerciseId: w.exercises[0]!.id, target: { clientGeneratedId: key(n) }, body: { clientGeneratedId: key(n), weight: 60, weightUnit: "kg", reps: 5, isComplete: true } }) as OutboxOp;
const note = (w: WorkoutDetail, status: "queued" | "failed"): OutboxOp =>
  ({ ...base(w, "note", status), kind: "note", workoutExerciseId: w.exercises[0]!.id, body: { notes: "tight hips" } }) as OutboxOp;
const round = (w: WorkoutDetail, status: "queued" | "failed"): OutboxOp =>
  ({ ...base(w, "round", status), kind: "round", sectionId: w.sections[0]!.id, round: 1, body: { seconds: 61 } }) as OutboxOp;
const result = (w: WorkoutDetail, status: "queued" | "failed"): OutboxOp =>
  ({ ...base(w, "result", status), kind: "result", sectionId: w.sections[0]!.id, body: null }) as OutboxOp;
const finish = (w: WorkoutDetail, status: "queued" | "failed"): OutboxOp =>
  ({
    ...base(w, "finish", status),
    kind: "finish",
    body: { endedAt: "2026-10-02T11:00:00.000Z" },
    meta: { startedAt: w.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
  }) as OutboxOp;

/** The lifter is offline (nothing sends), with these writes stored from before. */
async function setup(ops: (w: WorkoutDetail) => OutboxOp[]) {
  const active = workoutOf();
  const fake = createWorkoutFake({ active });
  prepareApp({ auth, fake });
  online = false;
  fake.setOffline(true);
  localStorageAdapter().set(outboxKey(USER_ID), JSON.stringify({ v: 1, userId: USER_ID, idMap: {}, ops: ops(active) }));
  // The active read is the one request that must reach the fake before the outbox sends anything.
  fake.setOffline(false);
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  fake.setOffline(true);
  return { fake, ...app };
}

/** Every Finish door on screen (the free-form button, and the bar when it is in Finish mode). */
const doors = () => screen.getAllByRole("button", { name: "Finish workout" });
const freeFormFinish = () => doors()[0]!;
const status = () => screen.getByTestId("session-status");
async function menuItem(user: Awaited<ReturnType<typeof setup>>["user"]) {
  await user.click(screen.getByRole("button", { name: "Workout menu" }));
  // The menu sits above the list, so its item is the first "Finish workout" in DOM order (17.1 AC32's test).
  return doors()[0]!;
}

describe("06.7 AC21 — failedOpCount: every failed op of the workout except a finish", () => {
  it("counts failed sets, notes, rounds and results of this workout only", () => {
    const w = workoutOf();
    const other = workoutOf();
    const ops = [create(w, 1, "failed"), create(w, 2, "queued"), note(w, "failed"), round(w, "failed"), result(w, "failed"), finish(w, "failed"), create(other, 3, "failed")];
    expect(failedOpCount(ops, w.id)).toBe(4);
    expect(failedOpCount([], w.id)).toBe(0);
  });
});

describe("06.7 AC21 — Finish is unlocked by unsent writes and locked by refused ones", () => {
  it("queued sets, a note and a timer entry: every Finish door is enabled, and the line still lists what hasn't saved (17.4)", async () => {
    const { user } = await setup((w) => [create(w, 1, "queued"), create(w, 2, "queued"), create(w, 3, "queued")]);
    for (const door of doors()) expect(door).toBeEnabled();
    expect(status()).toHaveTextContent(/^3 sets not saved yet$/);
    const item = await menuItem(user);
    expect(item).toBeEnabled();
  });

  it.each([
    ["a set", (w: WorkoutDetail) => [create(w, 1, "failed")]],
    ["a note", (w: WorkoutDetail) => [note(w, "failed")]],
    ["a round", (w: WorkoutDetail) => [round(w, "failed")]],
    ["a result", (w: WorkoutDetail) => [result(w, "failed")]],
  ])("one refused write (%s) locks Finish, says so on the line, and gives the menu item the same reason", async (_name, ops) => {
    const { user } = await setup(ops);
    for (const door of doors()) expect(door).toBeDisabled();
    expect(status()).toHaveTextContent(/^1 thing couldn't be saved — fix it first$/);
    const item = await menuItem(user);
    expect(item).toBeDisabled();
    expect(item).toHaveAccessibleDescription("1 thing couldn't be saved — fix it first");
  });

  it("with 2 refused and 3 queued, the line says only the refusal (D19)", async () => {
    const { user } = await setup((w) => [create(w, 1, "failed"), create(w, 2, "failed"), create(w, 3, "queued"), create(w, 4, "queued"), create(w, 5, "queued")]);
    expect(status()).toHaveTextContent(/^2 things couldn't be saved — fix them first$/);
    expect(await menuItem(user)).toHaveAccessibleDescription("2 things couldn't be saved — fix them first");
  });

  it("a refused finish op doesn't lock Finish (tapping it again replaces the op, AC2)", async () => {
    await setup((w) => [finish(w, "failed")]);
    expect(freeFormFinish()).toBeEnabled();
  });
});
