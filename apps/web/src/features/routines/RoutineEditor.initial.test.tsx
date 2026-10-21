import { screen } from "@testing-library/react";
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

import { markupOf } from "../../test/markup";
import { catalog, pushA } from "../../test/routineFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { routineId } from "../../test/workoutFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

describe("10.4 AC30 — a non-import editor is unchanged", () => {
  it.each([
    ["new", "/app/workouts/routines/new", "New routine"],
    ["edit", `/app/workouts/routines/${routineId(1)}/edit`, "Edit routine"],
  ])("%s: the markup recorded before the import editor existed", async (_, path, title) => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    renderApp(path);
    await screen.findByLabelText("Name");
    if (title === "Edit routine") await screen.findByDisplayValue("Push A");
    expect(markupOf(screen.getByRole("region", { name: title }))).toMatchSnapshot();
  });
});
