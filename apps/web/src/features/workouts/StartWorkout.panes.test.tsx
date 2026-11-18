import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useMatch, type RouteObject } from "react-router";
import { ROUTINES_PER_USER_MAX } from "@sin/core";
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

/** Spec 17.12 Phase D, Task 2: the Start screen as the list of a `Panes` layout, before the real route group exists. */
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

const paneRoutes: RouteObject[] = [
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
                  { path: "routines/:id/edit", element: <Screen title="Edit routine" /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

const routines = [makeRoutine({ id: routineId(1), name: "Push A" }), makeRoutine({ id: routineId(2), name: "Pull B" })];

async function renderPanes(path: string, list = routines) {
  prepareApp({ auth, fake: createWorkoutFake({ routines: list }) });
  const router = createMemoryRouter(paneRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Start a workout" });
  return { router };
}

const listPane = () => document.querySelectorAll<HTMLElement>("[data-pane]")[0]!;
const startButton = () => within(listPane()).getByRole("button", { name: "Start empty workout" });

describe("17.12 AC25 — Start empty workout at the top of the list pane", () => {
  it("wide: the Start button is the first button after the h2, with no action bar in the list", async () => {
    setDesktop(true);
    await renderPanes("/app/workouts");
    const list = listPane();
    const heading = within(list).getByRole("heading", { level: 2, name: "Start a workout" });
    const first = within(list).getAllByRole("button")[0];
    expect(first).toBe(startButton());
    expect(heading.compareDocumentPosition(first!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.querySelector("[data-action-bar]")).toBeNull();
    // Above the routine list, not under it.
    const routinesHeading = await within(list).findByRole("heading", { name: "Routines" });
    expect(first!.compareDocumentPosition(routinesHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("M2: primary beside 'Choose a routine', secondary while a routine's preview or editor is open", async () => {
    setDesktop(true);
    const { router } = await renderPanes("/app/workouts");
    expect(startButton()).toHaveAttribute("data-variant", "primary");
    await act(() => router.navigate(`/app/workouts/routines/${routineId(1)}`));
    expect(startButton()).toHaveAttribute("data-variant", "secondary");
    await act(() => router.navigate(`/app/workouts/routines/${routineId(1)}/edit`));
    expect(startButton()).toHaveAttribute("data-variant", "secondary");
    await act(() => router.navigate("/app/workouts"));
    expect(startButton()).toHaveAttribute("data-variant", "primary");
  });

  it("narrow: today's markup, the Start button in the bottom action bar", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ routines }) });
    const router = createMemoryRouter(
      [
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
                      element: (
                        <StartWorkout notice={null} onStarted={() => {}}>
                          <RoutinesSection />
                        </StartWorkout>
                      ),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      { initialEntries: ["/app/workouts"] },
    );
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const start = await screen.findByRole("button", { name: "Start empty workout" });
    expect(start.closest("[data-action-bar]")).not.toBeNull();
    expect(start).toHaveAttribute("data-variant", "primary");
    expect(screen.getByRole("heading", { level: 1, name: "Start a workout" })).toBeInTheDocument();
  });

  it("review focus 5: at the routine cap the list pane's New routine is disabled with its reason", async () => {
    setDesktop(true);
    const many = Array.from({ length: ROUTINES_PER_USER_MAX }, (_, i) => makeRoutine({ id: routineId(i + 1), name: `Routine ${i + 1}` }));
    await renderPanes("/app/workouts", many);
    const newRoutine = await within(listPane()).findByRole("button", { name: "New routine" });
    expect(newRoutine).toBeDisabled();
    expect(newRoutine).toHaveAccessibleDescription(/routines/i);
  });
});

describe("17.12 AC29 — the open routine's row is marked", () => {
  it("wide: the open routine's row is aria-current (a plain click stays put); every row links to its preview", async () => {
    setDesktop(true);
    const { router } = await renderPanes(`/app/workouts/routines/${routineId(1)}/edit`);
    const list = listPane();
    const open = await within(list).findByRole("link", { name: /Push A/ });
    const other = within(list).getByRole("link", { name: /Pull B/ });
    expect(open).toHaveAttribute("aria-current", "page");
    expect(open).toHaveAttribute("href", `/app/workouts/routines/${routineId(1)}`);
    expect(open.querySelector("[data-row-title]")).toHaveTextContent("Push A");
    expect(other).not.toHaveAttribute("aria-current");
    expect(other).toHaveAttribute("href", `/app/workouts/routines/${routineId(2)}`);
    expect(other.querySelector("[data-row-title]")).toHaveTextContent("Pull B");

    await act(() => router.navigate("/app/workouts"));
    expect(within(list).getByRole("link", { name: /Push A/ })).not.toHaveAttribute("aria-current");
  });
});
