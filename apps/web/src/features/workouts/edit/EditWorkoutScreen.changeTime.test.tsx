import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
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

import { RETIME_MESSAGES, type WorkoutDetail } from "@sin/core";
import { pinTimeZone } from "../../../test/timeZone";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../../test/workoutHarness";
import { changeTimeButton, editDoneButton } from "../../../test/sessionHelpers";
import { HISTORY_KEYS } from "../../history/queries";
import { WORKOUT_KEYS } from "../queries";
import { EDIT_COPY } from "./editCopy";

pinTimeZone("Europe/London");
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date("2026-10-18T10:00:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;

async function open(times: { startedAt?: string; endedAt?: string; tzOffsetMinutes?: number } = {}) {
  const workout = makeWorkoutDetail({
    startedAt: times.startedAt ?? "2026-10-14T17:05:00.000Z",
    endedAt: times.endedAt ?? "2026-10-14T17:57:00.000Z",
    localDate: "2026-10-14",
    tzOffsetMinutes: times.tzOffsetMinutes ?? 60,
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1 })] }],
  });
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake });
  const app = renderApp(`/app/history/${workout.id}/edit`);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  return { fake, workout, ...app };
}

const sheet = () => within(screen.getByRole("dialog", { name: "Change Time" }));
const sheetOpen = () => screen.queryByRole("dialog", { name: "Change Time" }) !== null;
const patches = (fake: Fake) => fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workouts/")).map((r) => r.body);
const save = (user: Awaited<ReturnType<typeof open>>["user"]) => user.click(sheet().getByRole("button", { name: "Save time" }));
const set = (label: string, value: string) => fireEvent.change(sheet().getByLabelText(label), { target: { value } });

describe("18.0 AC40 — Change Time on a finished workout", () => {
  it("is a secondary button after the Took text", async () => {
    await open();
    const took = screen.getByText(/Took 52 min/);
    const button = changeTimeButton();
    expect(took.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.className).toMatch(/secondary/);
  });

  it("Took is required: emptied, it shows the copy and sends nothing", async () => {
    const { user, fake } = await open();
    await user.click(changeTimeButton());
    set("Hours", "");
    set("Minutes", "");
    await save(user);
    expect(sheet().getByText(EDIT_COPY.tookRequired)).toBeInTheDocument();
    expect(patches(fake)).toEqual([]);
  });

  it("a new day sends the start alone; banner, header and status follow; History resets; Done re-reads records once", async () => {
    const { user, fake, workout, queryClient } = await open();
    queryClient.setQueryData(HISTORY_KEYS.list, { pages: [{ items: [], next: null }], pageParams: [null] });
    await user.click(changeTimeButton());
    set("Day", "2026-10-16");
    await save(user);
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(patches(fake)).toEqual([{ startedAt: "2026-10-16T17:05:00.000Z", tzOffsetMinutes: 60 }]);
    expect(screen.getByText("Editing Fri 16 Oct workout")).toBeInTheDocument();
    expect(screen.getByText("Started Fri 16 Oct, 18:05 · Took 52 min")).toBeInTheDocument();
    expect(screen.getByTestId("edit-announcement")).toHaveTextContent("Time changed");
    expect(queryClient.getQueryState(HISTORY_KEYS.list)?.data).toBeUndefined();

    const before = fake.requests.length;
    await user.click(editDoneButton());
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    await waitFor(() =>
      expect(fake.requests.slice(before).filter((r) => r.path === "/v1/personal-records" && r.search === `?workoutId=${workout.id}`)).toHaveLength(1),
    );
  });
});

describe("18.0 AC41 — edit failures", () => {
  it("offline: the offline copy in the sheet, values kept, the detail untouched", async () => {
    const { user, fake, workout, queryClient } = await open();
    await user.click(changeTimeButton());
    const cached = queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workout.id));
    fake.setOffline(true);
    set("Day", "2026-10-16");
    await save(user);
    expect(await sheet().findByText(EDIT_COPY.offline)).toBeInTheDocument();
    expect(sheet().getByLabelText("Day")).toHaveValue("2026-10-16");
    expect(queryClient.getQueryData(WORKOUT_KEYS.detail(workout.id))).toBe(cached);
  });

  it("404: the vanished view", async () => {
    const { user, fake } = await open();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\// }, () => {
      fake.state.finished.clear();
      return problemResponse(404, "not-found");
    });
    await user.click(changeTimeButton());
    set("Day", "2026-10-16");
    await save(user);
    expect(await screen.findByText(EDIT_COPY.vanished)).toBeInTheDocument();
  });

  it("a server 422 on durationSeconds shows under Took", async () => {
    const { user, fake } = await open();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\// }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "durationSeconds", message: RETIME_MESSAGES.endsInFuture }] }),
    );
    await user.click(changeTimeButton());
    set("Minutes", "40");
    await save(user);
    expect(await sheet().findByText(EDIT_COPY.timeEndsInFuture)).toBeInTheDocument();
    expect(sheet().getByLabelText("Minutes")).toHaveAccessibleDescription(EDIT_COPY.timeEndsInFuture);
  });

  it("500: Couldn't change the time — try again", async () => {
    const { user, fake } = await open();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\// }, () => problemResponse(500, "about:blank"));
    await user.click(changeTimeButton());
    set("Minutes", "40");
    await save(user);
    expect(await sheet().findByText(EDIT_COPY.changeTimeFailed)).toBeInTheDocument();
  });
});

describe("18.0 AC42 — Done waits", () => {
  it("while the PATCH is held Done is disabled with Saving…, and a second Save time sends nothing", async () => {
    const { user, fake } = await open();
    const held = deferred<Response>();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\// }, () => held.promise as unknown as Response);
    await user.click(changeTimeButton());
    set("Minutes", "40");
    await save(user);
    await waitFor(() => expect(editDoneButton()).toBeDisabled());
    expect(screen.getByText(EDIT_COPY.saving)).toBeInTheDocument();
    fireEvent.submit(sheet().getByRole("button", { name: "Save time" }).closest("form")!);
    expect(patches(fake)).toHaveLength(1);
    await act(async () => held.resolve(problemResponse(500, "about:blank")));
    await waitFor(() => expect(editDoneButton()).toBeEnabled());
  });
});

describe("18.0 AC31 — a traveler workout: changing only Took keeps the day and the offset", () => {
  it("New York workout on a London phone: the body is the duration alone", async () => {
    const { user, fake, workout } = await open({ startedAt: "2026-10-14T22:05:37.000Z", endedAt: "2026-10-14T22:57:37.000Z", tzOffsetMinutes: -240 });
    await user.click(changeTimeButton());
    expect(sheet().getByLabelText("Minutes")).toHaveValue(52);
    set("Minutes", "30");
    await save(user);
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(patches(fake)).toEqual([{ durationSeconds: 1800 }]);
    expect(screen.getByText("Editing Wed 14 Oct workout")).toBeInTheDocument();
    expect(fake.state.finished.get(workout.id)!.tzOffsetMinutes).toBe(-240);
  });
});

describe("18.0 AC33 — a stored finish longer than 24 h", () => {
  it("shows Hours 30; changing only the start checks no Took and sends no duration", async () => {
    const { user, fake } = await open({ endedAt: "2026-10-15T23:05:00.000Z" });
    await user.click(changeTimeButton());
    expect(sheet().getByLabelText("Hours")).toHaveValue(30);
    set("Started at", "08:00");
    await save(user);
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(screen.queryByText(EDIT_COPY.tookMax)).toBeNull();
    expect(patches(fake)).toEqual([{ startedAt: "2026-10-14T07:00:00.000Z", tzOffsetMinutes: 60 }]);
  });
});
