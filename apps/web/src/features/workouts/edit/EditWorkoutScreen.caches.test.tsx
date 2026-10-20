import { act, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
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
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { WorkoutDetail } from "@sin/core";
import { localStorageAdapter } from "../../../storage/storage";
import { USER_ID } from "../../../test/catalogHarness";
import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { addSetButton, card, editDoneButton } from "../../../test/sessionHelpers";
import { OUTBOX_KEY } from "../outbox/outbox";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;

const heaviest = (w: WorkoutDetail) => [
  makePersonalRecord({ workoutId: w.id, recordType: "heaviest_weight", exerciseName: "Bench Press", value: Math.max(...w.exercises[0]!.sets.map((s) => s.weightKg ?? 0)), previousValue: null }),
];

function setup() {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 }), makeSet({ setNumber: 2, weight: 80, reps: 5 })] }],
  });
  const fake = createWorkoutFake({ finished: [workout], records: heaviest(workout), recordsFor: heaviest });
  prepareApp({ auth, fake });
  return { fake, workout };
}

const ready = () => screen.findByRole("heading", { level: 1, name: "Edit workout" });
const sheet = (name: RegExp | string) => within(screen.getByRole("dialog", { name }));
const since = (fake: Fake, mark: number) => fake.requests.slice(mark);
const recordsReads = (fake: Fake, mark: number, id: string) =>
  since(fake, mark).filter((r) => r.method === "GET" && r.path === "/v1/personal-records" && r.search === `?workoutId=${id}`).length;

async function changeWeight(user: ReturnType<typeof renderApp>["user"], from: RegExp, to: string) {
  await user.click(within(card("Bench Press")).getByRole("button", { name: from }));
  const s = sheet(/^Set \d/);
  await user.clear(s.getByLabelText("Weight"));
  await user.type(s.getByLabelText("Weight"), to);
  await user.click(s.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Set \d/ })).toBeNull());
}

describe("18.0 AC23 — no request burst; the summary is fresh", () => {
  it("edits make no list / progress / records reads; Done shows the new set and record after one ?workoutId read; History re-reads page 1", async () => {
    const { fake, workout } = setup();
    const { user, router } = renderApp("/app/history");
    await screen.findByRole("heading", { name: "History" });
    await act(() => router.navigate(`/app/history/${workout.id}`));
    await screen.findByRole("heading", { name: "Workout summary" });
    await user.click(screen.getByRole("button", { name: "Edit workout" }));
    await ready();

    const mark = fake.requests.length;
    await changeWeight(user, /80 kg × 5/, "100");
    await changeWeight(user, /60 kg × 8/, "65");
    await changeWeight(user, /65 kg × 8/, "70");
    const burst = since(fake, mark).filter(
      (r) => r.method === "GET" && (r.path === "/v1/workouts" || r.path.startsWith("/v1/progress/") || r.path === "/v1/personal-records"),
    );
    expect(burst).toEqual([]);

    const done = fake.requests.length;
    await user.click(editDoneButton());
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(await screen.findByText("100 kg × 5")).toBeInTheDocument();
    const records = await screen.findByRole("region", { name: "Personal records" });
    await waitFor(() => expect(records).toHaveTextContent(/100/));
    expect(recordsReads(fake, done, workout.id)).toBe(1);

    const history = fake.requests.length;
    await act(() => router.navigate("/app/history"));
    await screen.findByRole("heading", { name: "History" });
    await waitFor(() => expect(since(fake, history).filter((r) => r.method === "GET" && r.path === "/v1/workouts")).toHaveLength(1));
    expect(since(fake, history).find((r) => r.path === "/v1/workouts")!.search).not.toMatch(/cursor/);
  });

  it("Review Focus 1: leaving by the back gesture after an edit shows the edit with one ?workoutId read", async () => {
    const { fake, workout } = setup();
    const { user, router } = renderApp(`/app/history/${workout.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    await user.click(screen.getByRole("button", { name: "Edit workout" }));
    await ready();
    await changeWeight(user, /80 kg × 5/, "90");
    const back = fake.requests.length;
    await act(() => router.navigate(-1));
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(await screen.findByText("90 kg × 5")).toBeInTheDocument();
    await waitFor(() => expect(recordsReads(fake, back, workout.id)).toBe(1));
  });

  it("Review Focus 2: a late queued op for the open workout lands once, with no banner", async () => {
    const { workout } = setup();
    const key = "30000000-0000-4000-8000-0000000000f2";
    localStorageAdapter().set(
      OUTBOX_KEY,
      JSON.stringify({
        v: 1,
        userId: USER_ID,
        idMap: {},
        ops: [
          {
            id: "late",
            kind: "create",
            workoutId: workout.id,
            workoutExerciseId: workout.exercises[0]!.id,
            userId: USER_ID,
            status: "queued",
            attempted: false,
            attempts: 0,
            nextAttemptAt: 0,
            enqueuedAt: 0,
            target: { clientGeneratedId: key },
            body: { clientGeneratedId: key, reps: 3, weight: 50, weightUnit: "kg", isComplete: true },
          },
        ],
      }),
    );
    online = false;
    renderApp(`/app/history/${workout.id}/edit`);
    await ready();
    expect(within(card("Bench Press")).getAllByRole("listitem")).toHaveLength(2);
    online = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(within(card("Bench Press")).getAllByRole("listitem")).toHaveLength(3));
    expect(within(card("Bench Press")).getAllByRole("button", { name: /50 kg × 3/ })).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull(); // warning and error notices are alerts
  });
});

describe("18.0 AC27 — edit telemetry", () => {
  it("add, change and delete each emit one scalar workout_edit; no live event is emitted", async () => {
    const { workout } = setup();
    const { user } = renderApp(`/app/history/${workout.id}/edit`);
    await ready();
    await user.click(addSetButton("Bench Press"));
    await user.click(sheet("New set · Bench Press").getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New set · Bench Press" })).toBeNull());
    await changeWeight(user, /60 kg × 8/, "62.5");
    await user.click(within(card("Bench Press")).getByRole("button", { name: /62.5 kg × 8/ }));
    await user.click(sheet(/^Set 1/).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Set 1/ })).toBeNull());

    const calls = observability.track.mock.calls as [string, Record<string, unknown>][];
    expect(calls.filter(([name]) => name === "workout_edit").map(([, props]) => props)).toEqual([
      { edit: "set_added" },
      { edit: "set_changed" },
      { edit: "set_deleted" },
    ]);
    const live = ["set_logged", "set_edited", "set_deleted", "exercise_added", "exercise_removed", "exercise_moved"];
    expect(calls.filter(([name]) => live.includes(name))).toEqual([]);
    for (const [, props] of calls) {
      for (const value of Object.values(props ?? {})) {
        expect(["string", "number", "boolean"]).toContain(typeof value);
        expect(value).not.toBe("Bench Press");
        expect(value).not.toBe(62.5);
      }
    }
  });
});
