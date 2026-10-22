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

import type { PlannedSet } from "@sin/core";
import { catalog } from "../../test/routineFixtures";
import { discardWorkout, finishButton } from "../../test/sessionHelpers";
import { makeRoutine, makeRoutineItem, makeSet, makeWorkoutDetail, routineId, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { KEEP_AS_ROUTINE } from "../routines/messages";
import { KEEP_IN_ROUTINES, oneOffFinishLine } from "./messages";

const FUTURE = "2099-10-30T12:00:00.000Z";
const cls = makeRoutine({ id: routineId(5), name: "Class Fri 16 Oct", oneOffUntil: FUTURE, items: [makeRoutineItem({ exerciseId: catalog[0]!.id })] });
const ordinary = makeRoutine({ id: routineId(6), name: "Push A", items: [makeRoutineItem({ exerciseId: catalog[0]!.id })] });
const planned = (n: number): PlannedSet[] => Array.from({ length: n }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
const bench = (o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name: "Bench Press", sets: [makeSet()], ...o });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

interface Setup {
  routine?: typeof cls | null;
  exercises?: ExerciseSpec[];
  path?: string;
}

async function setup({ routine = cls, exercises = [bench()], path = "/app/workouts" }: Setup = {}) {
  const active = makeWorkoutDetail({ routineName: routine?.name ?? null, routineIsOneOff: routine?.oneOffUntil != null, exercises });
  const fake = createWorkoutFake({
    catalog,
    routines: [cls, ordinary],
    active,
    ...(routine ? { activeRoutineId: routine.id } : {}),
  });
  prepareApp({ auth, catalog, fake });
  const app = renderApp(path);
  if (path === "/app/workouts") await screen.findByRole("heading", { name: "Workout" });
  return { fake, active, ...app };
}

const finishDialog = () => screen.getByRole("dialog", { name: "Finish workout?" });
const endEarlyDialog = () => screen.getByRole("dialog", { name: "End workout early?" });
const keepBox = (dialog: HTMLElement) => within(dialog).getByRole("checkbox", { name: KEEP_IN_ROUTINES });
const patches = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "PATCH" && /^\/v1\/workouts\/[^/]+$/.test(r.path));
type User = Awaited<ReturnType<typeof setup>>["user"];
const openEndEarly = async (user: User) => {
  const menu = screen.getByRole("button", { name: "Workout menu" });
  if (menu.getAttribute("aria-expanded") !== "true") await user.click(menu);
  await user.click(screen.getByRole("button", { name: "End workout early" }));
};
const finished = () => screen.findByRole("heading", { level: 1, name: "Workout summary" });

describe("10.5 AC12 — both dialogs, one state, reset on each open", () => {
  it("End workout early shows the line and an unchecked box", async () => {
    const { user } = await setup({ exercises: [bench({ plannedSets: planned(3) })] });
    await openEndEarly(user);
    expect(within(endEarlyDialog()).getByText(oneOffFinishLine(cls.name))).toBeInTheDocument();
    expect(keepBox(endEarlyDialog())).not.toBeChecked();
  });

  it("Finish shows the line and an unchecked box", async () => {
    const { user } = await setup();
    await user.click(finishButton());
    expect(within(finishDialog()).getByText(oneOffFinishLine(cls.name))).toBeInTheDocument();
    expect(keepBox(finishDialog())).not.toBeChecked();
  });

  it("End workout early: check, cancel, reopen → unchecked", async () => {
    const { user } = await setup({ exercises: [bench({ plannedSets: planned(3) })] });
    await openEndEarly(user);
    await user.click(keepBox(endEarlyDialog()));
    expect(keepBox(endEarlyDialog())).toBeChecked();
    await user.click(within(endEarlyDialog()).getByRole("button", { name: "Keep logging" }));
    await openEndEarly(user);
    expect(keepBox(endEarlyDialog())).not.toBeChecked();
  });

  it("Finish: check, cancel, reopen → unchecked", async () => {
    const { user } = await setup();
    await user.click(finishButton());
    await user.click(keepBox(finishDialog()));
    await user.click(within(finishDialog()).getByRole("button", { name: "Keep logging" }));
    await user.click(finishButton());
    expect(keepBox(finishDialog())).not.toBeChecked();
  });

  it("nothing is persisted", async () => {
    const { user } = await setup();
    const before = Object.keys(window.localStorage).sort();
    await user.click(finishButton());
    await user.click(keepBox(finishDialog()));
    await user.click(keepBox(finishDialog()));
    await user.click(keepBox(finishDialog()));
    expect(Object.keys(window.localStorage).sort()).toEqual(before);
    expect(Object.keys(window.sessionStorage)).toEqual([]);
  });
});

describe("10.5 AC13 — the request", () => {
  it.each([
    [false, { endedAt: expect.any(String) }],
    [true, { endedAt: expect.any(String), keepRoutine: true }],
  ])("Finish, checked=%s → body", async (checked, body) => {
    const { fake, user } = await setup();
    await user.click(finishButton());
    if (checked) await user.click(keepBox(finishDialog()));
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(patches(fake)).toHaveLength(1));
    expect(patches(fake)[0]!.body).toStrictEqual(body);
  });

  it("End workout early sends keepRoutine when checked", async () => {
    const { fake, user } = await setup({ exercises: [bench({ plannedSets: planned(3) })] });
    await openEndEarly(user);
    await user.click(keepBox(endEarlyDialog()));
    await user.click(within(endEarlyDialog()).getByRole("button", { name: "End workout" }));
    await waitFor(() => expect(patches(fake)).toHaveLength(1));
    expect(patches(fake)[0]!.body).toStrictEqual({ endedAt: expect.any(String), keepRoutine: true });
    expect(fake.state.routines.get(cls.id)?.oneOffUntil).toBeNull();
  });

  it.each([
    ["a manual workout", null],
    ["an ordinary-routine workout", ordinary],
  ])("%s shows no line and sends exactly { endedAt }", async (_, routine) => {
    const { fake, user } = await setup({ routine });
    await user.click(finishButton());
    expect(within(finishDialog()).queryByRole("checkbox")).toBeNull();
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(patches(fake)).toHaveLength(1));
    expect(patches(fake)[0]!.body).toStrictEqual({ endedAt: expect.any(String) });
  });

  it("Try again after a failed finish keeps the choice", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ }, () => problemResponse(500, "about:blank"));
    await user.click(finishButton());
    await user.click(keepBox(finishDialog()));
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(patches(fake)).toHaveLength(2));
    expect(patches(fake)[1]!.body).toStrictEqual({ endedAt: expect.any(String), keepRoutine: true });
  });
});

describe("10.5 AC13 — the choice is fixed once Finish is tapped", () => {
  it("the box is disabled while the finish is in flight, so what is shown is what was sent", async () => {
    const { fake, user } = await setup();
    let release!: () => void;
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ }, () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(problemResponse(500, "about:blank"));
      }) as unknown as Response,
    );
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(patches(fake)).toHaveLength(1));
    const box = keepBox(finishDialog());
    expect(box).toBeDisabled();
    await user.click(box);
    expect(box).not.toBeChecked();
    release();
    await screen.findByRole("button", { name: "Try again" });
    expect(patches(fake)[0]!.body).toStrictEqual({ endedAt: expect.any(String) });
  });
});

describe("10.5 AC14 — discard and cancel change nothing", () => {
  it("discard sends no routine request; the one-off is still listed with its date", async () => {
    const { fake, user } = await setup();
    const before = fake.requests.length;
    await discardWorkout(user);
    await user.click(within(screen.getByRole("dialog", { name: "Discard this workout?" })).getByRole("button", { name: "Discard" }));
    await screen.findByRole("list", { name: "Routines" });
    const after = fake.requests.slice(before);
    expect(after.filter((r) => r.method !== "GET" && r.path.startsWith("/v1/routines"))).toEqual([]);
    expect(fake.state.routines.get(cls.id)?.oneOffUntil).toBe(FUTURE);
    expect(await screen.findByRole("link", { name: /Class Fri 16 Oct/ })).toHaveTextContent("One-off");
  });

  it("cancel sends nothing", async () => {
    const { fake, user } = await setup();
    await user.click(finishButton());
    await user.click(keepBox(finishDialog()));
    await user.click(within(finishDialog()).getByRole("button", { name: "Keep logging" }));
    expect(patches(fake)).toHaveLength(0);
  });
});

describe("10.5 AC16 — a stale flag is harmless", () => {
  it("routine deleted elsewhere while the dialog is open → the finish succeeds", async () => {
    const { fake, user } = await setup();
    await user.click(finishButton());
    expect(within(finishDialog()).getByText(oneOffFinishLine(cls.name))).toBeInTheDocument();
    fake.state.routines.delete(cls.id);
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await finished();
    expect(fake.state.active).toBeNull();
  });
});

describe("10.5 AC12 — Keep on the preview updates a live workout's dialog", () => {
  it("the active workout is refreshed at once, and its dialog shows no line", async () => {
    const { fake, user } = await setup({ path: `/app/workouts/routines/${cls.id}` });
    const button = await screen.findByRole("button", { name: KEEP_AS_ROUTINE });
    const activeReads = () => fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;
    const before = activeReads();
    await user.click(button);
    await screen.findByText("Kept in your routines.");
    await waitFor(() => expect(activeReads()).toBeGreaterThan(before));
    await user.click(screen.getByRole("link", { name: "Go to your workout" }));
    await screen.findByRole("heading", { name: "Workout" });
    await user.click(finishButton());
    expect(within(finishDialog()).queryByRole("checkbox")).toBeNull();
  });
});
