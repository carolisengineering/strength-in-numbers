import { screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { HttpResponse } from "msw";
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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { SectionTimer, WorkoutDetail } from "@sin/core";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { HISTORY_KEYS } from "../../history/queries";
import { WORKOUT_KEYS } from "../queries";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const AMRAP: SectionTimer = { format: "amrap", capSeconds: 900 };

async function openEdit() {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    sections: [{ name: "Finisher", timer: AMRAP, roundTimes: [{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }] }],
    exercises: [{ modality: "weight_reps", name: "Burpee", sectionIndex: 0, sets: [makeSet({ setNumber: 1 })] }],
  });
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake });
  const app = renderApp(`/app/history/${workout.id}/edit`);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  return { fake, workout, ...app };
}
type Opened = Awaited<ReturnType<typeof openEdit>>;

const sheet = () => within(screen.getByRole("dialog", { name: "Log result" }));
const resultWrites = (fake: Opened["fake"]) => fake.requests.filter((r) => /round-times|\/result$/.test(r.path)).map((r) => `${r.method} ${r.path.split("/").slice(-2).join("/")}`);

/** Shift both readings 30 s later and give a result, then Save. */
async function shiftAndSave(user: Opened["user"]) {
  await user.click(screen.getByRole("button", { name: "Log result for Finisher" }));
  const d = sheet();
  await user.clear(d.getByLabelText("Round 1"));
  await user.type(d.getByLabelText("Round 1"), "440");
  await user.clear(d.getByLabelText("Round 2"));
  await user.type(d.getByLabelText("Round 2"), "905");
  await user.click(d.getByRole("button", { name: "+1, increase rounds" }));
  await user.click(d.getByRole("button", { name: "+1, increase reps" }));
  await user.click(d.getByRole("button", { name: "Save" }));
  return d;
}

describe("10.7 AC42 — Log result on the edit screen", () => {
  it("sends the AC32 order one by one, writes each section into the detail, and runs editSucceeded once", async () => {
    const { user, fake, workout, queryClient } = await openEdit();
    const reset = vi.spyOn(queryClient, "resetQueries");
    await shiftAndSave(user);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log result" })).toBeNull());
    expect(resultWrites(fake)).toEqual(["PUT round-times/2", "PUT round-times/1", "PUT " + `${workout.sections[0]!.id}/result`]);
    const cached = queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workout.id))!.sections[0]!;
    expect(cached.roundTimes).toEqual([{ round: 1, seconds: 280 }, { round: 2, seconds: 545 }]);
    expect(cached.result).toEqual({ rounds: 1, reps: 1, finishSeconds: null, capped: false });
    expect(observability.track.mock.calls.filter(([e]) => e === "workout_edit")).toEqual([["workout_edit", { edit: "section_result_changed" }]]);
    expect(observability.track.mock.calls.filter(([e]) => e === "section_result_logged")).toEqual([]);
    expect(reset.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(HISTORY_KEYS.list))).toHaveLength(1);
    expect(screen.getByTestId("edit-announcement")).toHaveTextContent("Result saved");
  });

  it("offline: the sheet stays open with the offline line and nothing is sent", async () => {
    const { user, fake } = await openEdit();
    fake.setOffline(true);
    const d = await shiftAndSave(user);
    expect(await d.findByText("You're offline — try again when you have signal")).toBeInTheDocument();
    fake.setOffline(false);
    expect(resultWrites(fake)).toEqual([]);
  });

  it("the second request fails: the first is applied, the third is not sent, the detail is re-read, the partial line shows", async () => {
    const { user, fake, workout } = await openEdit();
    fake.failNext({ method: "PUT", path: /round-times/ }, () => problemResponse(500, "about:blank"), 1, 1);
    const reads = () => fake.requests.filter((r) => r.method === "GET" && r.path === `/v1/workouts/${workout.id}`).length;
    const before = reads();
    const d = await shiftAndSave(user);
    expect(await d.findByText("Couldn't save all of the result — check it and try again")).toBeInTheDocument();
    expect(resultWrites(fake)).toEqual(["PUT round-times/2", "PUT round-times/1"]);
    expect(fake.state.finished.get(workout.id)!.sections[0]!.roundTimes).toEqual([{ round: 1, seconds: 250 }, { round: 2, seconds: 545 }]);
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it("a 404 on the first write closes the sheet with That section no longer exists", async () => {
    const { user, fake } = await openEdit();
    fake.failNext({ method: "PUT", path: /round-times/ }, () => problemResponse(404, "not-found"));
    await shiftAndSave(user);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log result" })).toBeNull());
    expect(screen.getByTestId("edit-announcement")).toHaveTextContent("That section no longer exists");
  });

  it("never touches the outbox storage key", async () => {
    const { user } = await openEdit();
    const set = vi.spyOn(Storage.prototype, "setItem");
    await shiftAndSave(user);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log result" })).toBeNull());
    const keys = set.mock.calls.map((c) => String(c[0]));
    set.mockRestore();
    expect(keys.filter((k) => /^sin:workout:/.test(k))).toEqual([]);
    expect(HttpResponse).toBeDefined();
  });
});
