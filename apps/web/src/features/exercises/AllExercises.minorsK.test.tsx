import { screen } from "@testing-library/react";
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

import { USER_ID } from "../../test/catalogHarness";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { resetDesktop, setDesktop } from "../../test/desktop";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { EXERCISES_COPY } from "./messages";

afterEach(() => {
  resetDesktop();
  cleanupApp();
});

const CATALOG = [makeExercise({ id: exerciseId(1), name: "Barbell bench press", ownerUserId: null }), makeExercise({ id: exerciseId(2), name: "Back squat", ownerUserId: USER_ID })];

async function searchRow(wide: boolean) {
  if (wide) setDesktop(true);
  prepareApp({ auth, fake: createWorkoutFake({ usage: [{ rootId: exerciseId(1), lastLoggedOn: "2026-10-24" }] }), catalog: CATALOG });
  renderApp("/app/exercises");
  const search = await screen.findByRole("searchbox", { name: EXERCISES_COPY.searchLabel });
  return search.parentElement!;
}

describe("minor 665 — the search row stacks in the 20rem list pane (owner, 2026-11-21)", () => {
  it("in the desktop list pane, + New exercise wraps under the field", async () => {
    expect(await searchRow(true)).toHaveAttribute("data-stacked");
  });

  it("on a phone, the row is unchanged", async () => {
    expect(await searchRow(false)).not.toHaveAttribute("data-stacked");
  });
});
