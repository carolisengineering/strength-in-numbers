import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
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

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { pinTimeZone } from "../../test/timeZone";
import { makeRoutine, makeRoutineItem, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { card, changeTimeButton, finishButton, logButton, restBetweenSets } from "../../test/sessionHelpers";

pinTimeZone("Europe/London");
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date("2026-10-18T10:00:00Z") });
});
afterEach(() => {
  vi.useRealTimers();
  cleanupApp();
});

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const sat = makeWorkoutDetail({ startedAt: "2026-10-17T09:00:00.000Z", endedAt: "2026-10-17T10:00:00.000Z", localDate: "2026-10-17" });
const thu = makeWorkoutDetail({ startedAt: "2026-10-15T09:00:00.000Z", endedAt: "2026-10-15T10:00:00.000Z", localDate: "2026-10-15" });
const working = { setType: "working" as const, repsLow: 5, repsHigh: 5, weight: 60, weightUnit: "kg" as const };
const routine = makeRoutine({ name: "Push A", items: [makeRoutineItem({ exerciseId: bench.id, sets: [working, working] })] });

function boot() {
  const fake = createWorkoutFake({ finished: [sat, thu], catalog: [bench], routines: [routine] });
  prepareApp({ auth, fake, catalog: [bench] });
  return { fake, ...renderApp("/app/workouts") };
}

type App = ReturnType<typeof boot>;

/** Change Time: two days back, 18:00, took 1 h. */
async function backdate(user: App["user"]) {
  await user.click(changeTimeButton());
  const sheet = within(screen.getByRole("dialog", { name: "Change Time" }));
  fireEvent.change(sheet.getByLabelText("Day"), { target: { value: "2026-10-16" } });
  fireEvent.change(sheet.getByLabelText("Started at"), { target: { value: "18:00" } });
  fireEvent.change(sheet.getByLabelText("Hours"), { target: { value: "1" } });
  fireEvent.change(sheet.getByLabelText("Minutes"), { target: { value: "0" } });
  await user.click(sheet.getByRole("button", { name: "Save time" }));
  expect(await screen.findByText("Took 1 h")).toBeInTheDocument();
}

/** Finish, then the summary and History say the 16th. */
async function finishAndCheck({ user, fake, router }: App, logged: () => Promise<void>) {
  await logged();
  await user.click(finishButton());
  await user.click(within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" }));
  await screen.findByRole("heading", { level: 1, name: "Workout summary" });
  const finish = fake.requests.find((r) => r.method === "PATCH" && (r.body as { endedAt?: string }).endedAt !== undefined)!;
  expect(finish.body).toEqual({ endedAt: "2026-10-16T18:00:00.000Z" });
  const stored = [...fake.state.finished.values()].find((w) => w.localDate === "2026-10-16")!;
  expect(stored.plannedDurationSeconds).toBeNull();
  expect(screen.getByText("1 h")).toBeInTheDocument();
  expect(screen.getByText("Fri 16 Oct")).toBeInTheDocument();

  await act(() => router.navigate("/app/history"));
  await waitFor(() => expect(historyDays()).toHaveLength(3), { timeout: 5_000 });
  expect(historyDays()).toEqual(["Sat 17 Oct", "Fri 16 Oct", "Thu 15 Oct"]);
}

const historyDays = () =>
  screen
    .queryAllByRole("link")
    .filter((l) => /^\/app\/history\/[^/]+$/.test(l.getAttribute("href") ?? ""))
    .map((l) => /^\w{3} \d+ \w{3}/.exec(l.textContent ?? "")?.[0]);

describe("18.0 AC39 — the forgotten-workout flow, end to end", () => {
  it("empty: Start → Change Time → log two sets → Finish ends at start + took and lands on the 16th", async () => {
    const app = boot();
    const { user } = app;
    await user.click(await screen.findByRole("button", { name: "Start empty workout" }));
    await screen.findByRole("heading", { name: "Workout" });
    await backdate(user);
    await finishAndCheck(app, async () => {
      await user.click(screen.getByRole("button", { name: "Add exercise" }));
      const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
      await user.click(within(within(dialog).getByRole("region", { name: "All exercises" })).getByRole("button", { name: /Bench Press/ }));
      await screen.findByRole("article", { name: "Bench Press" });
      await user.type(within(card("Bench Press")).getByLabelText("Weight"), "60");
      await user.type(within(card("Bench Press")).getByLabelText("Reps"), "5");
      await user.click(logButton("Bench Press"));
      await within(card("Bench Press")).findByText(/60 kg × 5/);
      await restBetweenSets();
      await user.click(logButton("Bench Press"));
      await waitFor(() => expect(within(card("Bench Press")).getAllByText(/60 kg × 5/)).toHaveLength(2), { timeout: 5_000 });
    });
  });

  it("from a routine: the planned sets prefill, and the same assertions hold", async () => {
    const app = boot();
    const { user, router } = app;
    await act(() => router.navigate(`/app/workouts/routines/${routine.id}`));
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    await screen.findByRole("heading", { name: "Workout" });
    await backdate(user);
    expect(within(card("Bench Press")).getByLabelText("Weight")).toHaveValue("60");
    expect(within(card("Bench Press")).getByLabelText("Reps")).toHaveValue("5");
    await finishAndCheck(app, async () => {
      await user.click(logButton("Bench Press"));
      await within(card("Bench Press")).findByText(/60 kg × 5/);
      await restBetweenSets();
      await user.click(logButton("Bench Press"));
      await waitFor(() => expect(within(card("Bench Press")).getAllByText(/60 kg × 5/)).toHaveLength(2), { timeout: 5_000 });
    });
  });
});
