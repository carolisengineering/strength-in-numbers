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

import { exerciseId } from "../../test/catalogFixtures";
import { catalog } from "../../test/routineFixtures";
import { makeRoutine, makeRoutineItem, makeRoutineSection, routineId, sectionId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

describe("10.7 AC11 — preview", () => {
  it("the plan line sits under the timed heading only", async () => {
    const routine = makeRoutine({
      id: routineId(5),
      name: "Conditioning",
      sections: [
        makeRoutineSection({ id: sectionId(1), position: 0, name: "Warm-up" }),
        makeRoutineSection({ id: sectionId(2), position: 1, name: "Main", timer: { format: "set_timer", roundSeconds: 300, rounds: 5 } }),
      ],
      items: [
        makeRoutineItem({ position: 0, exerciseId: exerciseId(1), sectionId: sectionId(1) }),
        makeRoutineItem({ position: 1, exerciseId: exerciseId(2), sectionId: sectionId(2) }),
      ],
    });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [routine] }) });
    renderApp(`/app/workouts/routines/${routineId(5)}`);
    await screen.findByRole("heading", { level: 1, name: "Conditioning" });
    const main = screen.getByRole("region", { name: "Main" });
    const heading = within(main).getByRole("heading", { name: "Main" });
    const line = within(main).getByText("Set Timer 5 × 5:00");
    expect(heading.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Warm-up" })).queryByText(/Set Timer|AMRAP|Time Cap|For Time/)).toBeNull();
  });
});
