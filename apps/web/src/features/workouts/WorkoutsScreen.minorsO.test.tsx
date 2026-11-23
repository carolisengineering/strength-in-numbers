import { act, screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";
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
import { resetDesktop, setDesktop } from "../../test/desktop";
import { server } from "../../test/msw/server";
import { catalog, pushA } from "../../test/routineFixtures";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { RESUMED_NOTICE } from "./WorkoutsScreen";

afterEach(() => {
  resetDesktop();
  cleanupApp();
});

const panes = () => [...document.querySelectorAll<HTMLElement>("[data-pane]")];
const listPane = () => panes()[0]!;

async function setup() {
  setDesktop(true);
  const fake = createWorkoutFake({ routines: [pushA], catalog, active: null });
  prepareApp({ auth, fake, catalog });
  const app = renderApp("/app/workouts");
  await waitFor(() => expect(panes()).toHaveLength(2));
  return { fake, ...app };
}

describe("minor 666 — a slow start from the list pane doesn't pull the lifter back", () => {
  it("tap Start empty workout, go to History before it lands: the lifter stays on History", async () => {
    const { router, user } = await setup();
    const held = deferred<void>();
    let posted = false;
    // Held, then let through to the fake's own handler.
    server.use(
      http.post(`${API_BASE_URL}/v1/workouts`, async () => {
        posted = true;
        await held.promise;
      }),
    );
    await user.click(within(listPane()).getByRole("button", { name: "Start empty workout" }));
    await waitFor(() => expect(posted).toBe(true));
    await act(() => router.navigate("/app/history"));
    held.resolve();
    // The start lands (Workouts would show the session on return), but nothing navigates.
    await new Promise((r) => setTimeout(r, 100));
    expect(router.state.location.pathname).toBe("/app/history");
    await act(() => router.navigate("/app/workouts"));
    expect(await screen.findByRole("heading", { level: 1, name: "Workout" })).toBeInTheDocument();
  });

  it("Review Focus 5: a start that resumes says so on the session screen, at desktop widths", async () => {
    const { fake, user } = await setup();
    fake.state.active = makeWorkoutDetail(); // started on another device after this screen loaded
    await user.click(within(listPane()).getByRole("button", { name: "Start empty workout" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Workout" })).toBeInTheDocument();
    expect(await screen.findByText(RESUMED_NOTICE)).toBeInTheDocument();
    expect(panes()).toEqual([]);
  });
});
