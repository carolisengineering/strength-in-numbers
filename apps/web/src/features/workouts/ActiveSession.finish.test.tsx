import { screen, waitFor, within } from "@testing-library/react";
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
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { makePersonalRecord, makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { deleteSetIn, discardWorkout, finishButton, logButton } from "../../test/sessionHelpers";
import { WORKOUT_KEYS } from "./queries";

const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  observability.track.mockReset();
  scrollIntoView.mockReset();
  cleanupApp();
});

const oneSet: ExerciseSpec[] = [
  { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] },
];

async function setup(exercises: ExerciseSpec[] = oneSet) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

const patches = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "PATCH" && /^\/v1\/workouts\//.test(r.path));
const finishDialog = () => screen.getByRole("dialog", { name: "Finish workout?" });

describe("AC26 — Finish: confirm and success", () => {
  it("is disabled, with a hint, while the workout has no sets", async () => {
    await setup([{ modality: "weight_reps", name: "X" }]);

    expect(finishButton()).toBeDisabled();
    expect(screen.getByText("Log at least one set to finish")).toBeInTheDocument();
  });

  it("opens a confirmation stating the exercise and working-set counts (17.2 AC1; amended by 18.0 D21: no can't-be-edited sentence)", async () => {
    const { user } = await setup([
      { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 }), makeSet({ setNumber: 2 })] },
      { modality: "bodyweight_reps", name: "Y", sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null })] },
    ]);

    await user.click(finishButton());

    // Spec 17.2 AC1/AC4: a stats list (2 exercises, 3 working sets), then the sentence.
    expect(within(finishDialog()).getByText("exercises").previousElementSibling).toHaveTextContent("2");
    expect(within(finishDialog()).getByText("sets").previousElementSibling).toHaveTextContent("3");
    expect(finishDialog()).not.toHaveTextContent(/can't be edited/);
  });

  it("shows one exercise and one set as figures (17.2 AC1)", async () => {
    const { user } = await setup();
    await user.click(finishButton());
    expect(within(finishDialog()).getByText("exercises").previousElementSibling).toHaveTextContent("1");
    expect(within(finishDialog()).getByText("sets").previousElementSibling).toHaveTextContent("1");
    expect(finishDialog()).not.toHaveTextContent(/can't be edited/);
  });

  it("Keep logging closes the dialog and sends nothing", async () => {
    const { fake, user } = await setup();
    await user.click(finishButton());

    await user.click(within(finishDialog()).getByRole("button", { name: "Keep logging" }));

    expect(screen.queryByRole("dialog", { name: "Finish workout?" })).not.toBeInTheDocument();
    expect(patches(fake)).toHaveLength(0);
  });

  it("confirming sends one PATCH { endedAt } and goes to the summary; the active query is gone", async () => {
    const { fake, user, router, queryClient } = await setup();
    const id = fake.state.active!.id;
    await user.click(finishButton());

    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`));
    expect(patches(fake)).toHaveLength(1);
    expect(Object.keys(patches(fake)[0]!.body as object)).toEqual(["endedAt"]);
    // The summary clears the entry from a passive effect after it mounts (Spec 06.4 D1), so wait for it.
    await waitFor(() => expect(queryClient.getQueryData(WORKOUT_KEYS.active)).toBeUndefined());
    expect(queryClient.getQueryData<{ endedAt: string | null }>(WORKOUT_KEYS.detail(id))?.endedAt).not.toBeNull();
    expect(observability.track).toHaveBeenCalledWith(
      "workout_finished",
      expect.objectContaining({ exerciseCount: 1, setCount: 1 }),
    );
  });

  it("then revisiting /app/workouts shows the Start screen", async () => {
    const { user, router } = await setup();
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/workouts\/.+/));

    await router.navigate("/app/workouts");

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });

  it("a double tap on the confirm button sends one request", async () => {
    const { fake, user } = await setup();
    await user.click(finishButton());

    await user.dblClick(within(finishDialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(patches(fake).length).toBeGreaterThan(0));
    expect(patches(fake)).toHaveLength(1);
  });

  // Amended by Spec 06.7 AC21 (2026-11-16): queued writes no longer hold Finish; a refused one does. (06.2 AC16)
  it("Finish stays enabled while a set write is not saved yet: the finish sends after it", async () => {
    const { fake, user } = await setup();
    fake.setOffline(true); // the send fails at the network and is retried
    const row = within(screen.getByRole("article", { name: "X" }));
    await user.type(row.getByLabelText("Weight"), "{Control>}a{/Control}61"); // prefilled: replace
    expect(finishButton()).toBeEnabled();

    await user.click(logButton("X"));

    expect(await screen.findByText("1 set not saved yet")).toBeInTheDocument();
    expect(finishButton()).toBeEnabled();
  });
});

describe("AC27 — 409 incomplete-working-sets", () => {
  const incomplete = (): ExerciseSpec[] => [
    {
      modality: "weight_reps",
      name: "X",
      sets: [
        makeSet({ setNumber: 1, weight: 60, reps: 0 }), // a failed attempt: reps 0 is NOT incomplete
        makeSet({ setNumber: 2, weight: null, weightUnit: null, reps: 8, isComplete: false }),
        makeSet({ setNumber: 3, weight: null, weightUnit: null, reps: 8, setType: "warmup", isComplete: false }), // warm-ups never block
      ],
    },
  ];

  it("refetches, marks exactly the offending row, shows the banner and scrolls to it; fixing it lets Finish succeed", async () => {
    const { fake, user, router } = await setup(incomplete());
    const id = fake.state.active!.id;
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("1 working set is missing data. Fix or delete them, then finish again.");
    const card = screen.getByRole("article", { name: "X" });
    const flagged = within(card).getAllByText("Needs data");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.closest("button")).toHaveTextContent(/– × 8/);
    expect(within(card).getByRole("button", { name: /60 kg × 0/ })).not.toHaveTextContent("Needs data");
    expect(scrollIntoView).toHaveBeenCalled();
    expect(observability.track).toHaveBeenCalledWith("finish_blocked", { incompleteCount: 1 });

    // Tap the flagged row: the sheet opens with the partial values; fix the missing weight.
    await user.click(flagged[0]!.closest("button")!);
    const sheet = screen.getByRole("dialog", { name: /Set 2/ });
    expect(within(sheet).getByLabelText("Reps")).toHaveValue("8");
    expect(within(sheet).getByLabelText("Weight")).toHaveValue("");
    await user.type(within(sheet).getByLabelText("Weight"), "60");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(card).queryByText("Needs data")).not.toBeInTheDocument());

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`));
  });

  it("deleting the offending set also clears the flag", async () => {
    const { user } = await setup(incomplete());
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    const flagged = (await within(screen.getByRole("article", { name: "X" })).findAllByText("Needs data"))[0]!;

    await user.click(flagged.closest("button")!);
    await deleteSetIn(user, screen.getByRole("dialog", { name: /Set 2/ }));

    await waitFor(() => expect(screen.queryByText("Needs data")).not.toBeInTheDocument());
  });

  // Moved (Spec 06.7 B2): the server disagreeing with the local check is now a refused finish op; its banner is AC29's.
});

describe("AC28 — other finish outcomes", () => {
  it("06.7 AC3 — 409 workout-finished whose re-read is finished elsewhere is treated as saved", async () => {
    const { fake, user, router } = await setup();
    const id = fake.state.active!.id;
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "workout-finished"));
    // Another device finished it a minute ago: the server now has it finished, with that device's end time.
    fake.state.finished.set(id, { ...fake.state.active!, endedAt: new Date(Date.now() - 60_000).toISOString() });
    fake.state.active = null;
    await user.click(finishButton());

    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`));
    expect(observability.track).toHaveBeenCalledWith("workout_finish_elsewhere", {});
  });

  // The 422 clock refusal and the 404 gone path are a refused finish op since Spec 06.7: ActiveSession.refused.test.tsx
  // (AC29) and WorkoutsScreen.waiting.test.tsx (AC30's gone card).

  it("06.7 AC13 — a network failure is retried by the outbox within the wait, then lands: no banner, the summary opens", async () => {
    const { fake, user, router } = await setup();
    const id = fake.state.active!.id;
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => HttpResponse.error());
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`), { timeout: 4000 });
    expect(router.state.location.state ?? null).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(patches(fake)).toHaveLength(2);
  });
});

describe("AC29 — discard and the gone path", () => {
  const discardOpen = async (user: Awaited<ReturnType<typeof setup>>["user"]) => {
    await discardWorkout(user);
    return screen.getByRole("dialog", { name: "Discard this workout?" });
  };

  it("asks first, saying how many logged sets will be deleted", async () => {
    const { fake, user } = await setup();

    const dialog = await discardOpen(user);

    expect(dialog).toHaveTextContent("All 1 logged set will be deleted.");
    expect(fake.requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
  });

  it("confirming sends DELETE and lands on the Start screen", async () => {
    const { fake, user } = await setup();
    const dialog = await discardOpen(user);

    await user.click(within(dialog).getByRole("button", { name: "Discard" }));

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
    expect(observability.track).toHaveBeenCalledWith("workout_discarded", { phase: "active", setCount: 1 });
  });

  it("404 on discard is success", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "DELETE", path: /\/v1\/workouts\// }, () => problemResponse(404, "not-found"));
    fake.state.active = null;
    const dialog = await discardOpen(user);

    await user.click(within(dialog).getByRole("button", { name: "Discard" }));

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });

  it("a network failure shows a retryable error", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "DELETE", path: /\/v1\/workouts\// }, () => HttpResponse.error());
    const dialog = await discardOpen(user);
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You're offline — try again when you have signal"); // 06.2 AC15
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });

  it("Cancel keeps the workout", async () => {
    const { fake, user } = await setup();
    const dialog = await discardOpen(user);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Discard this workout?" })).not.toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
  });

  it("06.2 AC16 AC17 — a 409 workout-finished on a set write fails the row and keeps Finish disabled", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(409, "workout-finished"));
    const row = within(screen.getByRole("article", { name: "X" }));

    await user.click(logButton("X"));

    expect(await row.findByText("Couldn't save")).toBeInTheDocument();
    expect(finishButton()).toBeDisabled();
    // Spec 06.7 AC21, D19: a refusal takes the line by itself.
    expect(screen.getByText("1 thing couldn't be saved — fix it first")).toBeInTheDocument();
  });
});

describe("08.0 AC21 — finish lands on a summary with its PRs and no extra fetch", () => {
  it("shows newRecords on first paint, never GETs records, and History shows the new row with its badge", async () => {
    const active = makeWorkoutDetail({ exercises: oneSet });
    const fake = createWorkoutFake({ active, newRecordsOnFinish: [makePersonalRecord({ exerciseName: "X" })] });
    prepareApp({ auth, fake });
    const { user, router } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`));
    const block = await screen.findByRole("region", { name: /record/i });
    expect(within(block).getByRole("heading", { level: 3, name: "X" })).toBeInTheDocument(); // 17.6 AC2: a lift in the ledger
    expect(within(block).getByText("102.5 kg")).toBeInTheDocument();
    expect(fake.requests.some((r) => r.path === "/v1/personal-records")).toBe(false);

    await user.click(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "History" }));
    const row = await screen.findByRole("link", { name: /Records on 1 lift/ });
    expect(row).toHaveAttribute("href", `/app/history/${active.id}`);
  });
});

describe("08.0 AC7 — the 409 replay gets the cache effects", () => {
  it("06.7 AC3 — a lost reply reconciled as ours removes the records entry, so the summary fetches its records once by workoutId", async () => {
    const active = makeWorkoutDetail({ exercises: oneSet });
    const record = makePersonalRecord({ workoutId: active.id, exerciseName: "X" });
    // The finish really lands (its reply is lost), so the server holds the records it computed.
    const fake = createWorkoutFake({ active, newRecordsOnFinish: [record] });
    prepareApp({ auth, fake });
    const { user, router } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    fake.loseNextResponse({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ });

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`), { timeout: 4000 });
    const block = await screen.findByRole("region", { name: /record/i });
    expect(within(block).getByRole("heading", { level: 3, name: "X" })).toBeInTheDocument();
    expect(within(block).getByText("102.5 kg")).toBeInTheDocument();
    const gets = fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/personal-records");
    expect(gets).toEqual([expect.objectContaining({ search: `?workoutId=${active.id}` })]);
  });
});
