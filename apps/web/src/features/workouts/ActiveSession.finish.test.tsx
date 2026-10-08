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

const finishButton = () => screen.getByRole("button", { name: "Finish" });
const patches = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "PATCH" && /^\/v1\/workouts\//.test(r.path));
const finishDialog = () => screen.getByRole("dialog", { name: "Finish workout?" });

describe("AC26 — Finish: confirm and success", () => {
  it("is disabled, with a hint, while the workout has no sets", async () => {
    await setup([{ modality: "weight_reps", name: "X" }]);

    expect(finishButton()).toBeDisabled();
    expect(screen.getByText("Log at least one set to finish")).toBeInTheDocument();
  });

  it("opens a confirmation stating the exercise and set counts and that a finished workout can't be edited", async () => {
    const { user } = await setup([
      { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 }), makeSet({ setNumber: 2 })] },
      { modality: "bodyweight_reps", name: "Y", sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null })] },
    ]);

    await user.click(finishButton());

    expect(finishDialog()).toHaveTextContent("2 exercises · 3 sets. A finished workout can't be edited.");
  });

  it("uses singular nouns for one exercise and one set", async () => {
    const { user } = await setup();
    await user.click(finishButton());
    expect(finishDialog()).toHaveTextContent("1 exercise · 1 set. A finished workout can't be edited.");
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

  it("Finish waits for a set write that is not saved yet (06.2 AC16)", async () => {
    const { fake, user } = await setup();
    fake.setOffline(true); // the send fails at the network and is retried
    const row = within(screen.getByRole("article", { name: "X" }));
    await user.type(row.getByLabelText("Weight"), "{Control>}a{/Control}61"); // prefilled: replace
    expect(finishButton()).toBeEnabled();

    await user.click(row.getByRole("button", { name: "Log set" }));

    expect(finishButton()).toBeDisabled();
    fake.setOffline(false);
    await user.click(await screen.findByRole("button", { name: "Retry now" }));
    await waitFor(() => expect(finishButton()).toBeEnabled());
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
    await user.click(within(screen.getByRole("dialog", { name: /Set 2/ })).getByRole("button", { name: "Delete set" }));

    await waitFor(() => expect(screen.queryByText("Needs data")).not.toBeInTheDocument());
  });

  it("a set with reps: 0 is never flagged", async () => {
    const { fake, user } = await setup([
      { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 0 })] },
    ]);
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "incomplete-working-sets"));
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    // The server disagreed with the client's scan: the generic banner, not a wrong flag.
    expect(await screen.findByRole("alert")).toHaveTextContent("Some sets are incomplete — reload and check your sets.");
    expect(screen.queryByText("Needs data")).not.toBeInTheDocument();
    expect(finishButton()).toBeEnabled(); // Finish stays usable
  });
});

describe("AC28 — other finish outcomes", () => {
  it("409 workout-finished then GET /workouts/{id} with endedAt set is treated as success", async () => {
    const { fake, user, router } = await setup();
    const id = fake.state.active!.id;
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "workout-finished"));
    // The first attempt actually landed (or another tab finished it): the server now has it finished.
    fake.state.finished.set(id, { ...fake.state.active!, endedAt: new Date().toISOString() });
    fake.state.active = null;
    await user.click(finishButton());

    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`));
    expect(observability.track).toHaveBeenCalledWith(
      "workout_finished",
      expect.objectContaining({ viaReplay: true }),
    );
  });

  it("422 says the device clock looks wrong", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "endedAt", message: "Before startedAt" }] }),
    );
    await user.click(finishButton());

    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your device clock looks wrong — check the date and time, then try again.",
    );
  });

  it("404 takes the gone path", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(404, "not-found"));
    fake.state.active = null;
    await user.click(finishButton());

    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("That workout was already finished or removed.");
  });

  it("a network failure says so with the request id, and the retry works", async () => {
    const { fake, user, router } = await setup();
    const id = fake.state.active!.id;
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => HttpResponse.error());
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You're offline — try again when you have signal"); // 06.2 AC15
    expect(alert).toHaveTextContent(/Request ID: /);
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`));
    expect(patches(fake)).toHaveLength(2);
  });
});

describe("AC29 — discard and the gone path", () => {
  const discardOpen = async (user: Awaited<ReturnType<typeof setup>>["user"]) => {
    await user.click(screen.getByRole("button", { name: "Discard workout" }));
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

    await user.click(row.getByRole("button", { name: "Log set" }));

    expect(await row.findByText("Couldn't save")).toBeInTheDocument();
    expect(finishButton()).toBeDisabled();
    expect(screen.getByText("1 set not saved yet")).toBeInTheDocument();
  });
});

describe("08.0 AC7 — the 409 recovery path gets the cache effects", () => {
  it("removes the records entry so the summary fetches its records once by workoutId", async () => {
    const active = makeWorkoutDetail({ exercises: oneSet });
    const record = makePersonalRecord({ workoutId: active.id, exerciseName: "X" });
    const fake = createWorkoutFake({ active, records: [record] });
    prepareApp({ auth, fake });
    const { user, router } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "workout-finished"));
    fake.state.finished.set(active.id, { ...fake.state.active!, endedAt: new Date().toISOString() });
    fake.state.active = null;

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${active.id}`));
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByText(/X — Heaviest weight 102\.5 kg/)).toBeInTheDocument();
    const gets = fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/personal-records");
    expect(gets).toEqual([expect.objectContaining({ search: `?workoutId=${active.id}` })]);
  });
});
