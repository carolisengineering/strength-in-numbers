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

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { onlineManager } from "@tanstack/react-query";
import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { finishButton, logButton } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { RECORDS_KEYS } from "../records/queries";
import { __resetFinishListeners, onWorkoutFinished } from "./finishEvents";
import { KEEP_IN_ROUTINES } from "./messages";
import { outboxKey } from "./outbox/outbox";
import type { FinishOp } from "./outbox/ops";
import { REST_KEY } from "./restStore";
import { FROM_HOME } from "./summaryEntry";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  __resetFinishListeners();
  observability.track.mockReset();
  cleanupApp();
});

const STARTED = "2026-10-02T10:00:00.000Z";
const oneSet: ExerciseSpec[] = [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }];

async function setup({ exercises = oneSet, offline = false, routineIsOneOff = false } = {}) {
  const active = makeWorkoutDetail({ startedAt: STARTED, exercises, ...(routineIsOneOff ? { routineName: "Class", routineIsOneOff: true } : {}) });
  const fake = createWorkoutFake({ active });
  prepareApp({ auth, fake });
  // A rest timer is running for this workout (Spec 17.1): the tap clears it (§12 D6).
  localStorageAdapter().set(REST_KEY, JSON.stringify({ v: 1, userId: USER_ID, workoutId: active.id, startedAt: Date.now(), durationS: 90 }));
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  if (offline) {
    online = false;
    fake.setOffline(true);
    window.dispatchEvent(new Event("offline"));
  }
  const emitted = vi.fn();
  onWorkoutFinished(emitted);
  return { fake, active, emitted, ...app };
}

const dialog = () => screen.getByRole("dialog", { name: "Finish workout?" });
const storedOps = () => (JSON.parse(localStorageAdapter().get(outboxKey(USER_ID)) ?? '{"ops":[]}') as { ops: FinishOp[] }).ops;
const events = () => observability.track.mock.calls.map((c) => c[0] as string);
const patches = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "PATCH" && /^\/v1\/workouts\//.test(r.path));

describe("06.7 AC15 — a finish with no signal is not treated as in the cloud", () => {
  it("Finish offline opens the summary and does only the queued effects: rest cleared, workout_finish_queued; no Hevy event, no workout_finished, drafts kept, records untouched", async () => {
    const { active, emitted, user, router, queryClient, fake } = await setup({ offline: true });
    // An edited, unlogged draft: the lifter's typing survives until the cloud has the workout (D6).
    await user.type(within(screen.getByRole("article", { name: "X" })).getByLabelText("Weight"), "{Control>}a{/Control}62");
    await waitFor(() => expect(localStorageAdapter().get("sin:workout:drafts")).not.toBeNull());
    queryClient.setQueryData(RECORDS_KEYS.forWorkout(active.id), []);

    await user.click(finishButton());
    await user.click(within(dialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`));
    // Final review: the summary reads the tap's reason once and clears it, so a reload (a browser router keeps
    // history state) or Back words the message from the outbox instead of a stale "no signal".
    // Minor 696: only the list mark stays, so a delete there goes Back to Workouts.
    await waitFor(() => expect(router.state.location.state ?? null).toEqual(FROM_HOME));
    expect(screen.getByTestId("finish-saved")).toHaveTextContent("There's no signal");
    expect(events()).toContain("workout_finish_queued");
    expect(observability.track).toHaveBeenCalledWith("workout_finish_queued", { reason: "offline" });
    expect(events()).not.toContain("workout_finished");
    expect(emitted).not.toHaveBeenCalled();
    expect(localStorageAdapter().get("sin:workout:drafts")).not.toBeNull();
    expect(localStorageAdapter().get(REST_KEY)).toBeNull();
    expect(queryClient.getQueryState(RECORDS_KEYS.forWorkout(active.id))?.isInvalidated).toBe(false);
    expect(patches(fake)).toEqual([]);
  });
});

describe("06.7 AC23 — the Finish dialog's choices travel with the op", () => {
  it("the op holds the end time read once at the tap, the meta from the dialog's numbers, and no keepRoutine when unchecked", async () => {
    const { active, user } = await setup({ offline: true });
    await user.click(finishButton());
    const before = Date.now();
    await user.click(within(dialog()).getByRole("button", { name: "Finish" }));
    const after = Date.now();
    await waitFor(() => expect(storedOps()).toHaveLength(1));
    const [op] = storedOps();
    expect(op).toMatchObject({ kind: "finish", workoutId: active.id, status: "queued" });
    expect(Object.keys(op!.body)).toEqual(["endedAt"]);
    expect(Date.parse(op!.body.endedAt)).toBeGreaterThanOrEqual(before - 1);
    expect(Date.parse(op!.body.endedAt)).toBeLessThanOrEqual(after + 1);
    expect(op!.meta).toEqual({ startedAt: STARTED, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false });
  });

  it("a one-off's checked box adds keepRoutine: true (10.5 AC13)", async () => {
    const { user } = await setup({ offline: true, routineIsOneOff: true });
    await user.click(finishButton());
    await user.click(within(dialog()).getByRole("checkbox", { name: KEEP_IN_ROUTINES }));
    await user.click(within(dialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(storedOps()).toHaveLength(1));
    expect(storedOps()[0]!.body).toEqual({ endedAt: expect.any(String), keepRoutine: true });
  });
});

describe("06.7 AC17 — a local check runs at tap time", () => {
  const incomplete: ExerciseSpec[] = [
    {
      modality: "weight_reps",
      name: "X",
      sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 }), makeSet({ setNumber: 2, weight: null, weightUnit: null, reps: 8, isComplete: false })],
    },
  ];

  it.each([false, true])("an incomplete working set shows the banner and flags the row, with no op and no request (offline: %s)", async (offline) => {
    const { fake, user } = await setup({ exercises: incomplete, offline });
    await user.click(finishButton());
    await user.click(within(dialog()).getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("1 working set is missing data. Fix or delete them, then finish again.");
    expect(within(screen.getByRole("article", { name: "X" })).getAllByText("Needs data")).toHaveLength(1);
    expect(storedOps()).toEqual([]);
    expect(patches(fake)).toEqual([]);
  });
});

describe("06.7 AC14 — online, a finish that lands in time is today's result, its effects once", () => {
  it("the summary opens, workout_finished is tracked once (queued: false), the Hevy event fires once, the active entry goes", async () => {
    const { active, emitted, user, router, queryClient, fake } = await setup();
    await user.click(finishButton());
    await user.click(within(dialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`));
    expect(router.state.location.state ?? null).toEqual(FROM_HOME); // no `saved` (minor 696: the list mark only)
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(patches(fake)).toHaveLength(1);
    expect(events().filter((e) => e === "workout_finished")).toHaveLength(1);
    expect(observability.track).toHaveBeenCalledWith("workout_finished", expect.objectContaining({ queued: false, exerciseCount: 1, setCount: 1 }));
    expect(events()).not.toContain("workout_finish_queued");
    expect(emitted).toHaveBeenCalledOnce();
    await waitFor(() => expect(queryClient.getQueryData(["workouts", "active"]) ?? null).toBeNull());
    expect(storedOps()).toEqual([]);
  });

  it("a lost reply is replayed and reconciled as ours: the summary opens, viaReplay, one Hevy event", async () => {
    const { active, emitted, user, router, fake } = await setup();
    fake.loseNextResponse({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ });
    await user.click(finishButton());
    await user.click(within(dialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`), { timeout: 4000 });
    expect(observability.track).toHaveBeenCalledWith("workout_finished", expect.objectContaining({ viaReplay: true, queued: false }));
    expect(emitted).toHaveBeenCalledOnce();
  });
});

describe("06.7 AC34 — accessibility", () => {
  it("after an offline tap, focus lands on the summary's heading, and the saved message is a polite status region", async () => {
    const { user } = await setup({ offline: true });
    await user.click(finishButton());
    await user.click(within(dialog()).getByRole("button", { name: "Finish" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    await waitFor(() => expect(heading).toHaveFocus());
    const region = screen.getByTestId("finish-saved");
    expect(region).toHaveAttribute("role", "status");
    expect(region).not.toHaveAttribute("aria-live", "assertive");
  });
});

describe("minor 641 — a set queued offline before the Finish tap is on the summary", () => {
  it("log a set with no signal, tap Finish: the summary lists it", async () => {
    const { active, user, router } = await setup({ offline: true });
    await user.click(logButton("X"));
    await waitFor(() => expect(storedOps().some((o) => (o.kind as string) === "create")).toBe(true));

    await user.click(finishButton());
    await user.click(within(dialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`));
    const exercise = await screen.findByRole("region", { name: "X" });
    expect(within(exercise).getAllByRole("listitem")).toHaveLength(2);
  });
});
