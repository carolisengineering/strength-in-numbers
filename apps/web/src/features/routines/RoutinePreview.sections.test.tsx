import { screen, within } from "@testing-library/react";
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

import { markupOf } from "../../test/markup";
import { catalog, pushA, pushSectioned } from "../../test/routineFixtures";
import { routineId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

describe("10.3 AC20 — a section-free routine previews exactly as in 10.2", () => {
  it("the exercise list markup is unchanged (baseline recorded before Spec 10.3's edits)", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    renderApp(`/app/workouts/routines/${routineId(1)}`);
    await screen.findByRole("heading", { level: 1, name: "Push A" });
    expect(markupOf(screen.getByRole("list", { name: "Exercises" }))).toMatchSnapshot();
  });
});

describe("10.3 AC20 — preview grouping", () => {
  it("shows the sections read-only: loose exercises first without a heading, headings with their notes, empty sections as heading and note only, brackets inside sections", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushSectioned] }) });
    renderApp(`/app/workouts/routines/${routineId(2)}`);
    await screen.findByRole("heading", { level: 1, name: "Push B" });
    expect(screen.getByText("Keep the session under 75 minutes")).toBeInTheDocument(); // the routine's own note, as before
    const loose = screen.getByRole("list", { name: "Exercises" });
    expect(within(loose).getAllByRole("listitem")).toHaveLength(1);
    const warm = screen.getByRole("region", { name: "Warm-up" });
    expect(within(warm).getByText("5 min rower, then band pull-aparts")).toBeInTheDocument();
    expect(within(warm).queryAllByRole("listitem")).toEqual([]);
    const main = screen.getByRole("region", { name: "Main" });
    expect(within(main).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual([
      expect.stringMatching(/^Bench Press, superset 1/),
      expect.stringMatching(/^Barbell Row, superset 1/),
    ]);
    expect(main.querySelectorAll("[data-bracket]").length).toBeGreaterThan(0);
    expect(loose.querySelectorAll("[data-bracket='first'],[data-bracket='middle'],[data-bracket='last']")).toHaveLength(0);
  });
});
