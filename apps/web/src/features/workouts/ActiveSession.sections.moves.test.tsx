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

import { makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { linkToggleQuery, makeCurrent, optionsButton, showLinks } from "../../test/sessionHelpers";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const ex = (name: string, sectionIndex: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  sectionIndex,
  ...extra,
});
async function setup(opts: WorkoutDetailOptions) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail(opts) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const SECTIONED: WorkoutDetailOptions = {
  sections: [{ name: "A" }, { name: "B" }],
  exercises: [ex("a1", 0), ex("a2", 0), ex("a3", 0), ex("b1", 1), ex("b2", 1), ex("tail")],
};
const bodies = (fake: Awaited<ReturnType<typeof setup>>["fake"]) =>
  fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-exercises/")).map((r) => r.body as Record<string, unknown>);
/** `name` is the card's exact accessible name (these cards are not in a superset yet). */
const options = async (user: Awaited<ReturnType<typeof setup>>["user"], name: string) => {
  await makeCurrent(user, name);
  await user.click(optionsButton(name));
};

describe("17.13 AC14 — Move says why, in every workout (live)", () => {
  const moveIn = (name: string, which: "Move up" | "Move down") => within(screen.getByRole("article", { name: new RegExp(`^${name}`) })).getByRole("button", { name: which });

  it("a section-free workout: the first card's Move up reads First exercise, the last card's Move down reads Last exercise", async () => {
    const { user } = await setup({ exercises: [ex("x1"), ex("x2"), ex("x3")] });
    await options(user, "x1");
    expect(moveIn("x1", "Move up")).toHaveAccessibleDescription("First exercise");
    await options(user, "x3");
    expect(moveIn("x3", "Move down")).toHaveAccessibleDescription("Last exercise");
  });

  it("a middle card has no reason; a headed section keeps its own sentences", async () => {
    const { user } = await setup(SECTIONED);
    await options(user, "a2");
    expect(moveIn("a2", "Move up")).not.toHaveAccessibleDescription();
    await options(user, "a1");
    expect(moveIn("a1", "Move up")).toHaveAccessibleDescription("First exercise in this section");
  });

  it("review focus 5: one exercise shows both reasons", async () => {
    const { user } = await setup({ exercises: [ex("solo")] });
    await options(user, "solo");
    expect(moveIn("solo", "Move up")).toHaveAccessibleDescription("First exercise");
    expect(moveIn("solo", "Move down")).toHaveAccessibleDescription("Last exercise");
  });

  it("review focus 5: a loose tail's top row, below a headed section, reads First exercise", async () => {
    const { user } = await setup({ sections: [{ name: "A" }], exercises: [ex("a1", 0), ex("t1"), ex("t2")] });
    await options(user, "t1");
    expect(moveIn("t1", "Move up")).toHaveAccessibleDescription("First exercise");
  });
});

describe("10.3 AC26 — moves and links stay inside a section", () => {
  it("Move up / Move down are disabled (not hidden) at a segment's edges, with the reason in text", async () => {
    const { user } = await setup(SECTIONED);
    await options(user, "a1");
    const up = within(screen.getByRole("article", { name: /^a1/ })).getByRole("button", { name: "Move up" });
    expect(up).toBeDisabled();
    expect(up).toHaveAccessibleDescription("First exercise in this section");
    await options(user, "b2");
    expect(within(screen.getByRole("article", { name: /^b2/ })).getByRole("button", { name: "Move down" })).toBeDisabled(); // b2 is last in B; 'tail' is another segment
  });

  it("a card in the middle moves inside its segment with ONE absolute position (segment start + local index)", async () => {
    const { user, fake } = await setup(SECTIONED);
    await options(user, "b2");
    await user.click(within(screen.getByRole("article", { name: /^b2/ })).getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(bodies(fake)).toHaveLength(1));
    expect(bodies(fake)[0]).toEqual({ position: 3 }); // B starts at 3; b2 → local 0
    expect(fake.state.active!.exercises.map((e) => e.exerciseNameSnapshot)).toEqual(["a1", "a2", "a3", "b2", "b1", "tail"]);
  });

  it("the link toggle exists only between cards of the same segment; no body ever names sectionId or notes", async () => {
    const { user, fake } = await setup(SECTIONED);
    await showLinks(user); // Spec 17.7 AC19: the toggles are in the current card's Options
    expect(screen.queryByRole("button", { name: linkToggleQuery("a3", "b1") })).toBeNull();
    expect(screen.queryByRole("button", { name: linkToggleQuery("b2", "tail") })).toBeNull();
    await user.click(screen.getByRole("button", { name: linkToggleQuery("a1", "a2") }));
    await makeCurrent(user, "b1"); // Spec 17.1 AC16: the toggle shows only for the current card
    await showLinks(user);
    expect(screen.queryByRole("button", { name: linkToggleQuery("a3", "b1") })).toBeNull();
    await user.click(await screen.findByRole("button", { name: linkToggleQuery("b1", "b2") }));
    await waitFor(() => expect(bodies(fake).length).toBeGreaterThanOrEqual(2));
    for (const body of bodies(fake)) {
      expect(Object.keys(body).every((k) => k === "position" || k === "supersetGroup")).toBe(true);
    }
  });

  it("each section numbers its runs by itself, and the screen shows the on-screen ordinal", async () => {
    const { user } = await setup(SECTIONED);
    await showLinks(user);
    await user.click(screen.getByRole("button", { name: linkToggleQuery("a1", "a2") }));
    await waitFor(() => expect(screen.getByRole("article", { name: "a1, superset 1" })).toBeInTheDocument());
    await makeCurrent(user, "b1"); // Spec 17.1 AC16
    await showLinks(user);
    await user.click(screen.getByRole("button", { name: linkToggleQuery("b1", "b2") }));
    // the planner may reuse the stored number 1 in B; runs end at the heading, so B's run is 'superset 2' on screen
    await waitFor(() => expect(screen.getByRole("article", { name: "b1, superset 2" })).toBeInTheDocument());
  });

  it("a failed plain move offers Try again, which re-sends the same absolute position", async () => {
    const { user, fake } = await setup(SECTIONED);
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(500, "about:blank"));
    await options(user, "b2");
    await user.click(within(screen.getByRole("article", { name: /^b2/ })).getByRole("button", { name: "Move up" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(bodies(fake)).toHaveLength(2));
    expect(bodies(fake)[1]).toEqual(bodies(fake)[0]);
    expect(bodies(fake)[0]).toEqual({ position: 3 });
  });

  it("a section-free workout: edges still disabled, and since Spec 17.13 AC14 they say why", async () => {
    const { user } = await setup({ exercises: [ex("p"), ex("q")] });
    await options(user, "p");
    const up = within(screen.getByRole("article", { name: "p" })).getByRole("button", { name: "Move up" });
    expect(up).toBeDisabled();
    expect(up).toHaveAccessibleDescription("First exercise");
  });
});
