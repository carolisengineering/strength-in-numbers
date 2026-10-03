import type { Exercise } from "@sin/core";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
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

import { API_BASE_URL } from "../../test/catalogHarness";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

const EXERCISES_URL = `${API_BASE_URL}/v1/exercises`;

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const pullup = makeExercise({ id: exerciseId(2), name: "Pull-up", modality: "bodyweight_reps" });
const custom = makeExercise({
  id: exerciseId(9),
  name: "Zercher",
  modality: "weight_reps",
  ownerUserId: "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c",
  primaryMuscleId: null,
  equipmentId: null,
});

afterEach(() => cleanupApp());

interface SetupOptions {
  exercises?: ExerciseSpec[];
  /** What the app's picker shows. */
  catalog?: Exercise[];
  /** What the API resolves exercise ids against (defaults to the picker's catalog). */
  apiCatalog?: Exercise[];
}

async function setup({ exercises = [], catalog = [bench, pullup], apiCatalog }: SetupOptions = {}) {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({ exercises }),
    catalog: apiCatalog ?? catalog,
  });
  prepareApp({ auth, fake, catalog });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

const cardNames = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const card = (name: string) => screen.getByRole("article", { name });
const posts = (fake: ReturnType<typeof createWorkoutFake>, suffix: string) =>
  fake.requests.filter((r) => r.method === "POST" && r.path.endsWith(suffix));
const activeReads = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;

async function openPickerAndPick(user: ReturnType<typeof renderApp>["user"], name: RegExp) {
  await user.click(screen.getByRole("button", { name: "Add exercise" }));
  const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
  // A picked exercise also shows under Recents, so always pick from the A–Z list.
  const all = within(dialog).getByRole("region", { name: "All exercises" });
  await user.click(within(all).getByRole("button", { name }));
}

describe("AC17 — session layout and Add exercise", () => {
  it("renders exercises in position order, with the modality label", async () => {
    const detail = makeWorkoutDetail({
      exercises: [
        { modality: "weight_reps", name: "First" },
        { modality: "bodyweight_reps", name: "Second" },
        { modality: "duration", name: "Third" },
      ],
    });
    detail.exercises.reverse(); // the API order is not trusted: positions decide
    const fake = createWorkoutFake({ active: detail });
    prepareApp({ auth, fake });
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });

    expect(cardNames()).toEqual(["First", "Second", "Third"]);
    expect(within(card("First")).getByText("Weight × reps")).toBeInTheDocument();
    expect(within(card("Third")).getByText("Duration")).toBeInTheDocument();
  });

  it("shows an Add your first exercise hint when there are none, and a sticky bar with both actions", async () => {
    await setup();

    expect(screen.getByText("Add your first exercise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("the sticky bar comes after the cards and before the shell navigation", async () => {
    await setup({ exercises: [{ modality: "weight_reps", name: "First" }] });

    const cardEl = card("First");
    const bar = screen.getByRole("button", { name: "Add exercise" }).closest("[data-testid='session-bar']")!;
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(cardEl.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a pick sends exactly one POST { exerciseId }, closes the picker, shows a placeholder, then the card", async () => {
    const { fake, user } = await setup();
    const gate = deferred<void>();
    server.use(
      http.post(`${API_BASE_URL}/v1/workouts/:id/exercises`, async () => {
        await gate.promise;
        return HttpResponse.json(
          {
            id: "11111111-1111-4111-8111-111111111111",
            workoutId: fake.state.active!.id,
            position: 0,
            exerciseId: bench.id,
            exerciseNameSnapshot: "Bench Press",
            modalitySnapshot: "weight_reps",
            notes: null,
            createdAt: "2026-10-02T10:00:00.000Z",
            updatedAt: "2026-10-02T10:00:00.000Z",
          },
          { status: 201 },
        );
      }),
    );

    await openPickerAndPick(user, /Bench Press/);

    expect(screen.queryByRole("dialog", { name: "Add exercise" })).not.toBeInTheDocument();
    expect(screen.getByText("Adding Bench Press…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeDisabled();
    gate.resolve();
    await waitFor(() => expect(screen.queryByText("Adding Bench Press…")).not.toBeInTheDocument());
  });

  it("adds through the real API path: one POST, then the refetched card", async () => {
    const { fake, user } = await setup();

    await openPickerAndPick(user, /Bench Press/);

    expect(await screen.findByRole("article", { name: "Bench Press" })).toBeInTheDocument();
    expect(posts(fake, "/exercises")).toHaveLength(1);
    expect(posts(fake, "/exercises")[0]!.body).toStrictEqual({ exerciseId: bench.id });
    expect(screen.queryByText("Add your first exercise")).not.toBeInTheDocument();
  });

  it("a double tap on a pick sends one request", async () => {
    const { fake, user } = await setup();
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    const dialog = await screen.findByRole("dialog", { name: "Add exercise" });

    await user.dblClick(within(dialog).getByRole("button", { name: /Bench Press/ }));

    await screen.findByRole("article", { name: "Bench Press" });
    expect(posts(fake, "/exercises")).toHaveLength(1);
  });

  it("a set logged while an add's follow-up refetch is in flight does not lose the added card (final review I1)", async () => {
    const { fake, user } = await setup({
      exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }],
    });
    // The refetch that follows the add is held open; the lifter logs a set meanwhile. The set's
    // write cancels in-flight reads of the workout so a stale one cannot erase it — but that must
    // not silently swallow the add's own refetch.
    const gate = deferred<void>();
    let reads = 0;
    server.use(
      http.get(`${API_BASE_URL}/v1/workouts/active`, async () => {
        reads += 1;
        if (reads === 1) await gate.promise;
        return HttpResponse.json(fake.state.active);
      }),
    );
    await openPickerAndPick(user, /Pull-up/);
    await waitFor(() => expect(reads).toBe(1));

    await user.click(within(card("X")).getByRole("button", { name: "Log set" }));
    await within(card("X")).findAllByText("60 kg × 8").then((rows) => expect(rows).toHaveLength(2));
    gate.resolve();

    expect(await screen.findByRole("article", { name: "Pull-up" })).toBeInTheDocument();
    expect(screen.queryByText("Adding Pull-up…")).not.toBeInTheDocument();
  });

  it("the same exercise may be added twice", async () => {
    const { user } = await setup();

    await openPickerAndPick(user, /Bench Press/);
    await screen.findByRole("article", { name: "Bench Press" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add exercise" })).toBeEnabled());
    await openPickerAndPick(user, /Bench Press/);

    await waitFor(() => expect(screen.getAllByRole("article", { name: "Bench Press" })).toHaveLength(2));
  });

  it("an exercise created inside the picker is added through the same path", async () => {
    const { fake, user } = await setup({ apiCatalog: [bench, pullup, custom] });
    server.use(http.post(EXERCISES_URL, () => HttpResponse.json(custom, { status: 201 })));
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
    await user.type(within(dialog).getByLabelText("Search exercises"), "Zercher");
    await user.click(within(dialog).getByRole("button", { name: 'Can\'t find it? Create "Zercher"' }));
    await user.click(screen.getByRole("radio", { name: "Weight × reps" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("article", { name: "Zercher" })).toBeInTheDocument();
    expect(posts(fake, "/exercises")[0]!.body).toStrictEqual({ exerciseId: custom.id });
  });
});

describe("AC18 — add-exercise failures", () => {
  it("409 exercise-retired: says so and force-refreshes the catalog", async () => {
    const { user } = await setup({ apiCatalog: [{ ...bench, isActive: false }, pullup] });
    let reads = 0;
    server.use(
      http.get(EXERCISES_URL, () => {
        reads += 1;
        return HttpResponse.json({ exercises: [bench, pullup], syncToken: "1.101" });
      }),
    );
    const before = reads;

    await openPickerAndPick(user, /Bench Press/);

    expect(await screen.findByRole("alert")).toHaveTextContent("That exercise has been retired and can't be added");
    await waitFor(() => expect(reads).toBeGreaterThan(before));
  });

  it("404 with the workout still active: that exercise isn't available (and the catalog refreshes)", async () => {
    const { user } = await setup({ apiCatalog: [pullup] }); // the API cannot see the picked exercise
    let reads = 0;
    server.use(
      http.get(EXERCISES_URL, () => {
        reads += 1;
        return HttpResponse.json({ exercises: [bench, pullup], syncToken: "1.101" });
      }),
    );

    await openPickerAndPick(user, /Bench Press/);

    expect(await screen.findByRole("alert")).toHaveTextContent("That exercise isn't available");
    await waitFor(() => expect(reads).toBeGreaterThan(0));
  });

  it("404 because the workout is gone: Start screen with the gone notice", async () => {
    const { fake, user } = await setup();
    fake.state.active = null; // finished or deleted elsewhere

    await openPickerAndPick(user, /Bench Press/);

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("That workout was already finished or removed.");
  });

  it("409 workout-finished takes the gone path", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "POST", path: /\/exercises$/ }, () => problemResponse(409, "workout-finished"));
    fake.state.active = null;

    await openPickerAndPick(user, /Bench Press/);

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });

  it("a network failure refetches, then says it could not confirm — and offers no retry", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "POST", path: /\/exercises$/ }, () => HttpResponse.error());
    const readsBefore = activeReads(fake);

    await openPickerAndPick(user, /Bench Press/);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't confirm that exercise was added — check your workout before adding it again",
    );
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
    expect(activeReads(fake)).toBeGreaterThan(readsBefore);
  });
});

describe("AC19 — reorder", () => {
  const three: ExerciseSpec[] = [
    { modality: "weight_reps", name: "A" },
    { modality: "weight_reps", name: "B" },
    { modality: "weight_reps", name: "C" },
  ];
  const openOptions = async (user: ReturnType<typeof renderApp>["user"], name: string) =>
    user.click(within(card(name)).getByRole("button", { name: "Options" }));
  const patchBodies = (fake: ReturnType<typeof createWorkoutFake>) =>
    fake.requests.filter((r) => r.method === "PATCH").map((r) => r.body);

  it("Move up sends { position: p − 1 } and the order follows the refetched detail", async () => {
    const { fake, user } = await setup({ exercises: three });

    await openOptions(user, "B");
    await user.click(within(card("B")).getByRole("button", { name: "Move up" }));

    await waitFor(() => expect(cardNames()).toEqual(["B", "A", "C"]));
    expect(patchBodies(fake)).toEqual([{ position: 0 }]);
  });

  it("Move down sends { position: p + 1 }", async () => {
    const { fake, user } = await setup({ exercises: three });

    await openOptions(user, "B");
    await user.click(within(card("B")).getByRole("button", { name: "Move down" }));

    await waitFor(() => expect(cardNames()).toEqual(["A", "C", "B"]));
    expect(patchBodies(fake)).toEqual([{ position: 2 }]);
  });

  it("Move up is disabled on the first card and Move down on the last", async () => {
    const { user } = await setup({ exercises: three });

    await openOptions(user, "A");
    await openOptions(user, "C");

    expect(within(card("A")).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(card("A")).getByRole("button", { name: "Move down" })).toBeEnabled();
    expect(within(card("C")).getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  it("every move control is disabled while a structure write is pending", async () => {
    const { user } = await setup({ exercises: three });
    const gate = deferred<void>();
    server.use(
      http.patch(`${API_BASE_URL}/v1/workout-exercises/:id`, async () => {
        await gate.promise;
        return problemResponse(500, "about:blank");
      }),
    );
    await openOptions(user, "B");
    await openOptions(user, "C");

    await user.click(within(card("B")).getByRole("button", { name: "Move down" }));

    expect(within(card("C")).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(card("B")).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeDisabled();
    gate.resolve();
    await screen.findByRole("alert");
  });

  it("422 (stale position) refetches without an error banner", async () => {
    const { fake, user } = await setup({ exercises: three });
    fake.failNext({ method: "PATCH", path: /workout-exercises/ }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "position", message: "Out of range" }] }),
    );
    const reads = activeReads(fake);
    await openOptions(user, "B");

    await user.click(within(card("B")).getByRole("button", { name: "Move up" }));

    await waitFor(() => expect(activeReads(fake)).toBeGreaterThan(reads));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(cardNames()).toEqual(["A", "B", "C"]);
  });

  it("404 refetches; 409 workout-finished takes the gone path", async () => {
    const { fake, user } = await setup({ exercises: three });
    fake.failNext({ method: "PATCH", path: /workout-exercises/ }, () => problemResponse(404, "not-found"));
    const reads = activeReads(fake);
    await openOptions(user, "B");
    await user.click(within(card("B")).getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(activeReads(fake)).toBeGreaterThan(reads));

    fake.failNext({ method: "PATCH", path: /workout-exercises/ }, () => problemResponse(409, "workout-finished"));
    fake.state.active = null;
    // B's options row is still open from the first half of this test.
    await user.click(within(card("B")).getByRole("button", { name: "Move up" }));

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });

  it("a network failure shows a retryable error, and Try again repeats the move", async () => {
    const { fake, user } = await setup({ exercises: three });
    fake.failNext({ method: "PATCH", path: /workout-exercises/ }, () => HttpResponse.error());
    await openOptions(user, "B");

    await user.click(within(card("B")).getByRole("button", { name: "Move up" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You're offline — try again when you have signal"); // 06.2 AC15
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(cardNames()).toEqual(["B", "A", "C"]));
    expect(patchBodies(fake)).toEqual([{ position: 0 }, { position: 0 }]);
  });
});

describe("AC20 — remove", () => {
  const deletes = (fake: ReturnType<typeof createWorkoutFake>) =>
    fake.requests.filter((r) => r.method === "DELETE").map((r) => r.path);

  it("a card with no sets is removed at once, with no dialog", async () => {
    const { fake, user } = await setup({ exercises: [{ modality: "weight_reps", name: "A" }] });

    await user.click(within(card("A")).getByRole("button", { name: "Options" }));
    await user.click(within(card("A")).getByRole("button", { name: "Remove exercise" }));

    await waitFor(() => expect(screen.queryByRole("article", { name: "A" })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deletes(fake)).toHaveLength(1);
  });

  it("a card with sets asks first, naming the exercise and the number of sets that will go", async () => {
    const { fake, user } = await setup({
      exercises: [{ modality: "weight_reps", name: "A", sets: [makeSet({ setNumber: 1 }), makeSet({ setNumber: 2 }), makeSet({ setNumber: 3 })] }],
    });

    await user.click(within(card("A")).getByRole("button", { name: "Options" }));
    await user.click(within(card("A")).getByRole("button", { name: "Remove exercise" }));

    const dialog = await screen.findByRole("dialog", { name: "Remove A?" });
    expect(dialog).toHaveTextContent("3 sets will be deleted");
    expect(deletes(fake)).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByRole("article", { name: "A" })).not.toBeInTheDocument());
    expect(deletes(fake)).toHaveLength(1);
  });

  it("Cancel keeps the exercise and sends nothing", async () => {
    const { fake, user } = await setup({
      exercises: [{ modality: "weight_reps", name: "A", sets: [makeSet({ setNumber: 1 })] }],
    });
    await user.click(within(card("A")).getByRole("button", { name: "Options" }));
    await user.click(within(card("A")).getByRole("button", { name: "Remove exercise" }));

    await user.click(within(await screen.findByRole("dialog", { name: "Remove A?" })).getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("article", { name: "A" })).toBeInTheDocument();
    expect(deletes(fake)).toHaveLength(0);
  });

  it("404 counts as success", async () => {
    const { fake, user } = await setup({ exercises: [{ modality: "weight_reps", name: "A" }] });
    fake.failNext({ method: "DELETE", path: /workout-exercises/ }, () => problemResponse(404, "not-found"));
    fake.state.active = makeWorkoutDetail({ id: fake.state.active!.id, exercises: [] }); // already gone server-side

    await user.click(within(card("A")).getByRole("button", { name: "Options" }));
    await user.click(within(card("A")).getByRole("button", { name: "Remove exercise" }));

    await waitFor(() => expect(screen.queryByRole("article", { name: "A" })).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("409 workout-finished takes the gone path", async () => {
    const { fake, user } = await setup({ exercises: [{ modality: "weight_reps", name: "A" }] });
    fake.failNext({ method: "DELETE", path: /workout-exercises/ }, () => problemResponse(409, "workout-finished"));
    fake.state.active = null;

    await user.click(within(card("A")).getByRole("button", { name: "Options" }));
    await user.click(within(card("A")).getByRole("button", { name: "Remove exercise" }));

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });

  it("a network failure shows a retryable error and keeps the card", async () => {
    const { fake, user } = await setup({ exercises: [{ modality: "weight_reps", name: "A" }] });
    fake.failNext({ method: "DELETE", path: /workout-exercises/ }, () => HttpResponse.error());

    await user.click(within(card("A")).getByRole("button", { name: "Options" }));
    await user.click(within(card("A")).getByRole("button", { name: "Remove exercise" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You're offline — try again when you have signal"); // 06.2 AC15
    expect(screen.getByRole("article", { name: "A" })).toBeInTheDocument();
  });
});
