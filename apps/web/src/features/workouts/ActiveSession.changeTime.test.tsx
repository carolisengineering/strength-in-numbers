import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
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

import type { WorkoutDetail } from "@sin/core";
import { localStorageAdapter } from "../../storage/storage";
import { pinTimeZone } from "../../test/timeZone";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { card, changeTimeButton, logButton } from "../../test/sessionHelpers";
import { HISTORY_KEYS } from "../history/queries";
import { DRAFTS_KEY } from "./drafts/draftStore";
import { OUTBOX_KEY } from "./outbox/outbox";
import { WORKOUT_KEYS } from "./queries";
import { REST_KEY } from "./restStore";

pinTimeZone("Europe/London");
let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date("2026-10-18T10:00:00Z") });
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  vi.useRealTimers();
  cleanupApp();
});

const planned = (n: number) => Array.from({ length: n }, () => ({ setType: "working" as const, repsLow: 5, repsHigh: 5, weight: 60, weightUnit: "kg" as const }));
const squat = (): ExerciseSpec => ({ modality: "weight_reps", name: "Squat", restSeconds: 90, plannedSets: planned(3), sets: [makeSet({ setNumber: 1, weight: 60, reps: 5 })] });

async function setup(opts: { startedAt?: string; plan?: number | null; finished?: WorkoutDetail[] } = {}) {
  const active = makeWorkoutDetail({
    startedAt: opts.startedAt ?? "2026-10-18T09:05:00.000Z",
    localDate: "2026-10-18",
    tzOffsetMinutes: 60,
    plannedDurationSeconds: opts.plan ?? null,
    exercises: [squat()],
  });
  const fake = createWorkoutFake({ active, finished: opts.finished ?? [] });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, active, ...app };
}

const sheet = () => within(screen.getByRole("dialog", { name: "Change Time" }));
const sheetOpen = () => screen.queryByRole("dialog", { name: "Change Time" }) !== null;
const patches = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workouts/")).map((r) => r.body);

async function changeTime(user: ReturnType<typeof renderApp>["user"], values: { day?: string; time?: string; hours?: string; minutes?: string }) {
  await user.click(changeTimeButton());
  if (values.day !== undefined) fireEvent.change(sheet().getByLabelText("Day"), { target: { value: values.day } });
  if (values.time !== undefined) fireEvent.change(sheet().getByLabelText("Started at"), { target: { value: values.time } });
  if (values.hours !== undefined) fireEvent.change(sheet().getByLabelText("Hours"), { target: { value: values.hours } });
  if (values.minutes !== undefined) fireEvent.change(sheet().getByLabelText("Minutes"), { target: { value: values.minutes } });
  await user.click(sheet().getByRole("button", { name: "Save time" }));
}

describe("18.0 AC34 — the header's two rows", () => {
  it("row 1: the clock and Workout menu; row 2: Started and a secondary Change Time; the menu items come after", async () => {
    const { user } = await setup();
    const menu = screen.getByRole("button", { name: "Workout menu" });
    const row1 = menu.parentElement!;
    expect(within(row1).getByText(/Elapsed/)).toBeInTheDocument();
    const row2 = row1.nextElementSibling as HTMLElement;
    expect(within(row2).getByText("Started 10:05")).toBeInTheDocument();
    const button = within(row2).getByRole("button", { name: "Change Time" });
    expect(button.className).toMatch(/secondary/);
    await user.click(menu);
    const finish = screen.getByRole("button", { name: "End workout early" });
    expect(button.compareDocumentPosition(finish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(finish.parentElement!).queryByRole("button", { name: "Change Time" })).toBeNull();
    expect(within(row2).queryByText(/Took/)).toBeNull();
  });

  it("a start on another day reads with its date", async () => {
    await setup({ startedAt: "2026-10-16T17:00:00.000Z" });
    expect(screen.getByText("Started Fri 16 Oct, 18:00")).toBeInTheDocument();
  });
});

describe("18.0 AC35 — live save", () => {
  it("sends only the start, merges it, touches nothing else, announces; then a Took replaces the clock", async () => {
    const { user, fake, queryClient } = await setup();
    // A set queued offline, a typed draft and a running rest timer (the 18.0 AC21 setup).
    online = false;
    window.dispatchEvent(new Event("offline"));
    await user.click(logButton("Squat"));
    await waitFor(() => expect(localStorageAdapter().get(OUTBOX_KEY)).not.toBeNull());
    await waitFor(() => expect(localStorageAdapter().get(REST_KEY)).not.toBeNull());
    const reps = within(card("Squat")).getByLabelText("Reps");
    await user.clear(reps);
    await user.type(reps, "7");
    await waitFor(() => expect(localStorageAdapter().get(DRAFTS_KEY)).not.toBeNull());
    act(() => onlineManager.setOnline(true));
    const before = [OUTBOX_KEY, DRAFTS_KEY, REST_KEY].map((k) => localStorageAdapter().get(k));
    const requestsBefore = fake.requests.length;

    await changeTime(user, { day: "2026-10-16", time: "18:00" });
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(patches(fake)).toEqual([{ startedAt: "2026-10-16T17:00:00.000Z", tzOffsetMinutes: 60 }]);
    expect(screen.getByText("Started Fri 16 Oct, 18:00")).toBeInTheDocument();
    expect(screen.getByText(/Elapsed/)).toBeInTheDocument();
    expect([OUTBOX_KEY, DRAFTS_KEY, REST_KEY].map((k) => localStorageAdapter().get(k))).toEqual(before);
    const later = fake.requests.slice(requestsBefore).filter((r) => r.method === "GET");
    expect(later.filter((r) => r.path === "/v1/workouts" || r.path.startsWith("/v1/progress") || r.path.startsWith("/v1/personal-records"))).toEqual([]);
    expect(screen.getByTestId("session-announcement")).toHaveTextContent("Time changed");
    expect(queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)!.startedAt).toBe("2026-10-16T17:00:00.000Z");

    await changeTime(user, { hours: "1", minutes: "0" });
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(patches(fake).at(-1)).toEqual({ durationSeconds: 3600 });
    expect(screen.getByText("Took 1 h")).toBeInTheDocument();
    expect(screen.queryByText(/Elapsed/)).toBeNull();
  });
});

describe("18.0 AC36 — clearing Took", () => {
  it("with a plan, emptying both sends durationSeconds: null and the clock is back", async () => {
    const { user, fake } = await setup({ plan: 1800 });
    expect(screen.getByText("Took 30 min")).toBeInTheDocument();
    await changeTime(user, { hours: "", minutes: "" });
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(patches(fake)).toEqual([{ durationSeconds: null }]);
    expect(screen.getByText(/Elapsed/)).toBeInTheDocument();
  });

  it("without a plan, empty Took sends nothing", async () => {
    const { user, fake } = await setup();
    await changeTime(user, {});
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(patches(fake)).toEqual([]);
  });
});

describe("18.0 AC42 — structureBusy includes Change Time", () => {
  it("while the PATCH is held, Add exercise and Finish are disabled; afterwards both are enabled", async () => {
    const { user, fake } = await setup();
    const held = deferred<Response>();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\// }, () => held.promise as unknown as Response);
    await changeTime(user, { minutes: "30" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add exercise" })).toBeDisabled());
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    expect(screen.getByRole("button", { name: "End workout early" })).toBeDisabled();
    await act(async () => held.resolve(problemResponse(500, "about:blank")));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add exercise" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "End workout early" })).toBeEnabled();
  });
});

describe("18.0 AC41 — live failures", () => {
  it("404 hands off to the Start screen", async () => {
    const { user, fake } = await setup();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\// }, () => {
      fake.state.active = null;
      return problemResponse(404, "not-found");
    });
    await changeTime(user, { minutes: "30" });
    expect(await screen.findByRole("button", { name: "Start empty workout" })).toBeInTheDocument();
  });

  it("offline keeps the sheet open with the offline copy; the active cache is the same object", async () => {
    const { user, fake, queryClient } = await setup();
    const active = queryClient.getQueryData(WORKOUT_KEYS.active);
    fake.setOffline(true);
    await changeTime(user, { minutes: "30" });
    expect(await sheet().findByText("You're offline — try again when you have signal")).toBeInTheDocument();
    expect(sheet().getByLabelText("Minutes")).toHaveValue(30);
    expect(queryClient.getQueryData(WORKOUT_KEYS.active)).toBe(active);
  });
});

describe("18.0 AC35 — a live save answered with a finished workout", () => {
  it("the active key never holds an ended workout; the screen hands off and History is reset", async () => {
    const { user, fake, queryClient, active } = await setup();
    queryClient.setQueryData(HISTORY_KEYS.list, { pages: [{ items: [], next: null }], pageParams: [null] });
    const ended: (string | null)[] = [];
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      ended.push(queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active)?.endedAt ?? null);
    });
    // Finished on another device before this phone saves.
    fake.state.finished.set(active.id, { ...fake.state.active!, endedAt: "2026-10-18T09:55:00.000Z" });
    fake.state.active = null;
    await changeTime(user, { minutes: "30" });
    expect(await screen.findByRole("button", { name: "Start empty workout" })).toBeInTheDocument();
    unsubscribe();
    expect(ended.every((e) => e === null)).toBe(true);
    expect(queryClient.getQueryState(HISTORY_KEYS.list)?.data).toBeUndefined();
  });
});

describe("18.0 AC30 — reopening the sheet starts from the stored values", () => {
  it("after a save the saved values show and Save time sends nothing; abandoned typing is dropped", async () => {
    const { user, fake } = await setup();
    await changeTime(user, { day: "2026-10-16", time: "18:00" });
    await waitFor(() => expect(sheetOpen()).toBe(false));
    await user.click(changeTimeButton());
    expect([sheet().getByLabelText("Day"), sheet().getByLabelText("Started at")].map((e) => (e as HTMLInputElement).value)).toEqual(["2026-10-16", "18:00"]);
    await user.click(sheet().getByRole("button", { name: "Save time" }));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(patches(fake)).toHaveLength(1);

    await user.click(changeTimeButton());
    fireEvent.change(sheet().getByLabelText("Started at"), { target: { value: "07:00" } });
    await user.click(sheet().getByRole("button", { name: "Close" }));
    await user.click(changeTimeButton());
    expect(sheet().getByLabelText("Started at")).toHaveValue("18:00");
  });
});

