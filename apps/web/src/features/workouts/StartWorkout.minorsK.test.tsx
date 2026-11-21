import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { createMemoryRouter, RouterProvider, useBlocker, useMatch, type Blocker, type RouteObject } from "react-router";
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

import { BootstrapGate } from "../../app/BootstrapGate";
import { ProtectedLayout } from "../../app/ProtectedLayout";
import { ProtectedRoute } from "../../app/ProtectedRoute";
import { resetDesktop, setDesktop } from "../../test/desktop";
import { makeRoutine, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, makeQueryClient, prepareApp } from "../../test/workoutHarness";
import { Panes } from "../../ui/Panes";
import { Screen } from "../../ui/Screen";
import { RoutinesSection } from "../routines/RoutinesSection";
import { StartWorkout } from "./StartWorkout";

afterEach(() => {
  resetDesktop();
  cleanupApp();
});

/** The open editor's leave guard, which the test holds blocked and then answers "Keep editing" (reset). */
const guard: { blocking: boolean; blocker: Blocker | null } = { blocking: true, blocker: null };
function Editor() {
  const blocker = useBlocker(() => guard.blocking);
  useEffect(() => {
    guard.blocker = blocker;
  });
  return <Screen title="Edit routine" />;
}

function StartPanes() {
  const open = useMatch("/app/workouts/routines/:id/*");
  return (
    <Panes
      list={
        <StartWorkout notice={null} onStarted={() => {}}>
          <RoutinesSection />
        </StartWorkout>
      }
      selectedId={open?.params.id ?? null}
    />
  );
}

const routes: RouteObject[] = [
  {
    element: <BootstrapGate />,
    children: [
      {
        path: "/app",
        element: <ProtectedRoute />,
        children: [
          {
            element: <ProtectedLayout />,
            children: [
              {
                path: "workouts",
                element: <StartPanes />,
                children: [
                  { index: true, element: <Screen title="Choose a routine" /> },
                  { path: "routines/:id", element: <Screen title="Routine preview" /> },
                  { path: "routines/:id/edit", element: <Editor /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

describe("minor 673 — a canceled leave disarms Start", () => {
  it("Start beside a dirty editor, Keep editing, then a startEmpty entry this tap didn't make: nothing starts", async () => {
    setDesktop(true);
    guard.blocking = true;
    const fake = createWorkoutFake({ routines: [makeRoutine({ id: routineId(1), name: "Push A" })] });
    prepareApp({ auth, fake });
    const router = createMemoryRouter(routes, { initialEntries: [`/app/workouts/routines/${routineId(1)}/edit`] });
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Start a workout" });
    const list = document.querySelectorAll<HTMLElement>("[data-pane]")[0]!;
    await userEvent.setup().click(within(list).getByRole("button", { name: "Start empty workout" }));
    // The guard asked; the lifter keeps editing.
    await waitFor(() => expect(guard.blocker?.state).toBe("blocked"));
    act(() => guard.blocker!.reset!());
    guard.blocking = false;
    // The lifter moves on (a plain entry), and later a startEmpty entry arrives by another route.
    await act(() => router.navigate(`/app/workouts/routines/${routineId(1)}`));
    await act(() => router.navigate("/app/workouts", { state: { startEmpty: true } }));
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/workouts")).toEqual([]);
  });
});
