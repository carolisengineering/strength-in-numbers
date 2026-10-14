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
const options = async (user: Awaited<ReturnType<typeof setup>>["user"], name: string) =>
  user.click(within(screen.getByRole("article", { name: new RegExp(`^${name}(,|$)`) })).getByRole("button", { name: "Options" }));

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
    expect(screen.queryByRole("button", { name: "Superset a3 with b1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Superset b2 with tail" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Superset a1 with a2" }));
    await user.click(await screen.findByRole("button", { name: "Superset b1 with b2" }));
    await waitFor(() => expect(bodies(fake).length).toBeGreaterThanOrEqual(2));
    for (const body of bodies(fake)) {
      expect(Object.keys(body).every((k) => k === "position" || k === "supersetGroup")).toBe(true);
    }
  });

  it("each section numbers its runs by itself, and the screen shows the on-screen ordinal", async () => {
    const { user } = await setup(SECTIONED);
    await user.click(screen.getByRole("button", { name: "Superset a1 with a2" }));
    await waitFor(() => expect(screen.getByRole("article", { name: "a1, superset 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Superset b1 with b2" }));
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

  it("a section-free workout keeps today's behavior: no reason text, edges still disabled", async () => {
    const { user } = await setup({ exercises: [ex("p"), ex("q")] });
    await options(user, "p");
    const up = within(screen.getByRole("article", { name: "p" })).getByRole("button", { name: "Move up" });
    expect(up).toBeDisabled();
    expect(up).not.toHaveAccessibleDescription();
  });
});
