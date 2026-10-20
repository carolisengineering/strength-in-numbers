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
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../../test/workoutHarness";
import { card, cardNames, editDoneButton, optionsButton } from "../../../test/sessionHelpers";
import { EDIT_COPY } from "./editCopy";

const row = makeExercise({ id: exerciseId(1), name: "Row", modality: "weight_reps" });
const retired = makeExercise({ id: exerciseId(2), name: "Old Lift", modality: "weight_reps", isActive: false });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;

const lift = (name: string, sets = 1, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  sets: Array.from({ length: sets }, (_, i) => makeSet({ setNumber: i + 1, weight: 60, reps: 8 })),
  ...extra,
});

async function open(exercises: ExerciseSpec[]) {
  const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises });
  const fake = createWorkoutFake({ finished: [workout], catalog: [row, retired] });
  prepareApp({ auth, fake, catalog: [row, retired] });
  const app = renderApp(`/app/history/${workout.id}/edit`);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  return { fake, workout, ...app };
}
const writes = (fake: Fake) => fake.requests.filter((r) => r.method !== "GET");
const detailReads = (fake: Fake, id: string) => fake.requests.filter((r) => r.method === "GET" && r.path === `/v1/workouts/${id}`).length;

async function pick(user: Awaited<ReturnType<typeof open>>["user"], name: RegExp) {
  await user.click(screen.getByRole("button", { name: "Add exercise" }));
  const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
  await user.click(within(within(dialog).getByRole("region", { name: "All exercises" })).getByRole("button", { name }));
}

describe("18.0 AC9 — add an exercise", () => {
  it("from the end of the list: POST, a placeholder while held, then the new card last, loose, scrolled into view", async () => {
    const { fake, workout, user } = await open([lift("Bench Press")]);
    const held = deferred<void>();
    fake.failNext({ method: "POST", path: /\/exercises$/ }, (async () => {
      await held.promise;
      return problemResponse(500, "about:blank");
    }) as unknown as () => Response);
    await pick(user, /^Row/);
    expect(await screen.findByText("Adding Row…")).toBeInTheDocument();
    expect(editDoneButton()).toBeDisabled();
    held.resolve();
    expect(await screen.findByText(EDIT_COPY.unconfirmed)).toBeInTheDocument();
    expect(writes(fake).map((r) => r.path)).toEqual([`/v1/workouts/${workout.id}/exercises`]);

    await pick(user, /^Row/);
    await waitFor(() => expect(cardNames()).toEqual(["Bench Press", "Row"]));
    expect(within(card("Row")).queryByText(/^\d+ × \d+/)).toBeNull(); // no target line (loose, no plan)
    expect(within(card("Row")).queryAllByRole("listitem")).toEqual([]);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByTestId("edit-announcement")).toHaveTextContent("Exercise added: Row");
  });

  it("an empty finished workout shows the hint and only Add exercise", async () => {
    await open([]);
    expect(screen.getByText("Add your first exercise")).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeInTheDocument();
  });

  it("offline: the banner shows the offline copy with no Try again", async () => {
    const { fake, user } = await open([lift("Bench Press")]);
    fake.failNext({ method: "POST", path: /\/exercises$/ }, () => HttpResponse.error());
    await pick(user, /^Row/);
    expect(await screen.findByText(EDIT_COPY.offline)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("409 exercise-retired shows the retired copy", async () => {
    const { fake, user } = await open([lift("Bench Press")]);
    fake.failNext({ method: "POST", path: /\/exercises$/ }, () => problemResponse(409, "exercise-retired"));
    await pick(user, /^Row/);
    expect(await screen.findByText(EDIT_COPY.retired)).toBeInTheDocument();
  });
});

describe("18.0 AC10 — remove an exercise", () => {
  it("with no sets: removed at once; the detail is re-read and Exercise removed is announced", async () => {
    const { fake, workout, user } = await open([lift("Bench Press"), lift("Row", 0)]);
    await user.click(optionsButton("Row"));
    await user.click(within(card("Row")).getByRole("button", { name: "Remove exercise" }));
    await waitFor(() => expect(cardNames()).toEqual(["Bench Press"]));
    expect(writes(fake).map((r) => r.method)).toEqual(["DELETE"]);
    expect(detailReads(fake, workout.id)).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("edit-announcement")).toHaveTextContent("Exercise removed");
  });

  it("with sets: the confirm names the set count; Remove deletes", async () => {
    const { user } = await open([lift("Bench Press", 2), lift("Row")]);
    await user.click(optionsButton("Bench Press"));
    await user.click(within(card("Bench Press")).getByRole("button", { name: "Remove exercise" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Bench Press?" });
    expect(dialog).toHaveTextContent("2 sets will be deleted.");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(cardNames()).toEqual(["Row"]));
  });

  it("a 404 is done; a 500 shows the banner with Try again, which re-sends", async () => {
    const { fake, user } = await open([lift("Bench Press"), lift("Row", 0), lift("Dips", 0)]);
    fake.failNext({ method: "DELETE", path: /\/workout-exercises\// }, () => problemResponse(404, "not-found"));
    await user.click(optionsButton("Row"));
    await user.click(within(card("Row")).getByRole("button", { name: "Remove exercise" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    fake.failNext({ method: "DELETE", path: /\/workout-exercises\// }, () => problemResponse(500, "about:blank"));
    await user.click(optionsButton("Dips"));
    await user.click(within(card("Dips")).getByRole("button", { name: "Remove exercise" }));
    expect(await screen.findByText(EDIT_COPY.retry["remove-exercise"])).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(cardNames()).not.toContain("Dips"));
  });
});

describe("18.0 AC18 — removing the last exercise with sets", () => {
  it("409 workout-would-be-empty opens the last-set dialog; the card is unchanged", async () => {
    const { user } = await open([lift("Bench Press", 2)]);
    await user.click(optionsButton("Bench Press"));
    await user.click(within(card("Bench Press")).getByRole("button", { name: "Remove exercise" }));
    await user.click(within(screen.getByRole("dialog", { name: "Remove Bench Press?" })).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("dialog", { name: EDIT_COPY.lastSet.title })).toBeInTheDocument();
    expect(cardNames()).toEqual(["Bench Press"]);
  });
});

describe("18.0 AC11 — move and link", () => {
  it("Move down sends one PATCH { position }; a link toggle sends the plan then one re-read; telemetry is the edit event", async () => {
    const { fake, workout, user } = await open([lift("Bench Press"), lift("Row"), lift("Dips")]);
    await user.click(optionsButton("Bench Press"));
    await user.click(within(card("Bench Press")).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(cardNames()).toEqual(["Row", "Bench Press", "Dips"]));
    expect(writes(fake).map((r) => r.body)).toEqual([{ position: 1 }]);
    const reads = detailReads(fake, workout.id);
    await user.click(screen.getByRole("button", { name: "Superset Row with Bench Press" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Superset Row with Bench Press" })).toHaveAttribute("aria-pressed", "true"));
    expect(writes(fake).slice(1).map((r) => r.body)).toEqual([{ supersetGroup: 1 }, { supersetGroup: 1 }]);
    expect(detailReads(fake, workout.id)).toBe(reads + 1);
    const edits = observability.track.mock.calls.filter(([name]) => name === "workout_edit").map(([, props]) => props);
    expect(edits).toEqual([{ edit: "exercise_moved" }, { edit: "exercise_regrouped" }]);
    expect(observability.track.mock.calls.some(([name]) => name === "exercise_moved")).toBe(false);
  });

  it("a section edge shows its reason", async () => {
    const workout = makeWorkoutDetail({
      endedAt: "2026-10-02T11:00:00.000Z",
      sections: [{ name: "Main" }],
      exercises: [lift("Bench Press", 1, { sectionIndex: 0 }), lift("Row", 1, { sectionIndex: 0 })],
    });
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const { user } = renderApp(`/app/history/${workout.id}/edit`);
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    await user.click(optionsButton("Bench Press"));
    expect(within(card("Bench Press")).getByRole("button", { name: "Move up" })).toHaveAccessibleDescription("First exercise in this section");
  });

  it("a failed second PATCH of a plan: later PATCHes unsent, one re-read, the superset banner with no Try again", async () => {
    const { fake, workout, user } = await open([lift("Bench Press"), lift("Row"), lift("Dips")]);
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(500, "about:blank"), 1, 1);
    const reads = detailReads(fake, workout.id);
    await user.click(screen.getByRole("button", { name: "Superset Bench Press with Row" }));
    expect(await screen.findByText(EDIT_COPY.retry.regroup)).toBeInTheDocument();
    expect(writes(fake)).toHaveLength(2);
    expect(detailReads(fake, workout.id)).toBe(reads + 1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("a failed single move offers Try again, which re-sends the same absolute position", async () => {
    const { fake, user } = await open([lift("Bench Press"), lift("Row")]);
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(500, "about:blank"));
    await user.click(optionsButton("Bench Press"));
    await user.click(within(card("Bench Press")).getByRole("button", { name: "Move down" }));
    expect(await screen.findByText(EDIT_COPY.retry["move-exercise"])).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(cardNames()).toEqual(["Row", "Bench Press"]));
    expect(writes(fake).map((r) => r.body)).toEqual([{ position: 1 }, { position: 1 }]);
  });

  it("Review Focus 4: two Bench Press cards — Remove on the second deletes the second", async () => {
    const { fake, workout, user } = await open([lift("Bench Press"), lift("Bench Press", 0)]);
    const buttons = screen.getAllByRole("button", { name: "Options for Bench Press" });
    await user.click(buttons[1]!);
    await user.click(screen.getByRole("button", { name: "Remove exercise" }));
    await waitFor(() => expect(writes(fake)).toHaveLength(1));
    expect(writes(fake)[0]!.path).toBe(`/v1/workout-exercises/${workout.exercises[1]!.id}`);
  });
});
