import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, type InitialEntry } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false,
    isAuthenticated: false,
    error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

// Probes: the real screens are tested in their own files; here we only need to know what they are
// rendered inside of.
vi.mock("../features/workouts/WorkoutsScreen", async () => {
  const { useCatalogStore } = await import("../features/catalog/CatalogProvider");
  const { useWorkoutClient } = await import("../features/workouts/queries");
  const { useEffect } = await import("react");
  return {
    WorkoutsScreen: () => {
      const store = useCatalogStore();
      const client = useWorkoutClient();
      useEffect(() => {
        void store.refresh(true);
      }, [store]);
      return (
        <p data-testid="workouts-probe">
          {typeof store.refresh}/{typeof client.getActive}
        </p>
      );
    },
  };
});
vi.mock("../features/workouts/FinishedWorkoutScreen", async () => {
  const { useWorkoutClient } = await import("../features/workouts/queries");
  return {
    FinishedWorkoutScreen: () => <p data-testid="finished-probe">{typeof useWorkoutClient().getById}</p>,
  };
});

import { resetConfigCache } from "../config";
import { API_BASE_URL, stubWebEnv } from "../test/catalogHarness";
import { server } from "../test/msw/server";
import { catalogHandlers } from "../test/workoutFake";
import { NAV_ITEMS } from "./navItems";
import { routes } from "./router";

const ME_URL = `${API_BASE_URL}/v1/me`;
const ME = {
  id: "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c",
  email: "lifter@example.com",
  displayName: "Sam",
  unitPreference: "kg",
  timezone: "Europe/London",
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

beforeEach(() => {
  stubWebEnv();
  window.localStorage.clear();
  // Any refresh the probe triggers needs somewhere to go; individual tests override with real rows.
  server.use(...catalogHandlers([]));
  auth.state.isLoading = false;
  auth.state.isAuthenticated = true;
  auth.state.loginWithRedirect = vi.fn();
  auth.state.logout = vi.fn();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  server.use(http.get(ME_URL, () => HttpResponse.json(ME, { status: 200 })));
});
afterEach(() => {
  window.localStorage.clear();
  resetConfigCache();
  vi.unstubAllEnvs();
});

function renderAt(initialEntries: InitialEntry[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

describe("AC14 — routing and mounting", () => {
  it("/app redirects (replace) to /app/workouts", async () => {
    const { router } = renderAt(["/app"]);

    expect(await screen.findByTestId("workouts-probe")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/workouts");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("the Workouts nav item is no longer a coming-soon stub", () => {
    const workouts = NAV_ITEMS.find((item) => item.to === "/app/workouts");
    expect(workouts).toBeDefined();
    expect(workouts?.comingSoon).toBeUndefined();
    expect(NAV_ITEMS.filter((i) => i.comingSoon)).toEqual([]); // Spec 08.1: every section is live
  });

  it("/app/workouts and /app/workouts/:id are protected children of the shell", async () => {
    renderAt(["/app/workouts/00000000-0000-4000-8000-000000000001"]);

    const shell = await screen.findByTestId("app-shell");
    expect(shell).toContainElement(await screen.findByTestId("finished-probe"));
  });

  it("unauthenticated visits to the workouts routes never reach the screens", async () => {
    auth.state.isAuthenticated = false;
    const { router } = renderAt(["/app/workouts/00000000-0000-4000-8000-000000000001"]);

    expect(await screen.findByTestId("landing")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByTestId("finished-probe")).toBeNull();
  });

  it("<CatalogProvider> and the workout client mount only after GET /v1/me is 200", async () => {
    let releaseMe!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseMe = resolve;
    });
    server.use(
      http.get(ME_URL, async () => {
        await held;
        return HttpResponse.json(ME, { status: 200 });
      }),
    );
    renderAt(["/app/workouts"]);

    expect(await screen.findByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("workouts-probe")).toBeNull(); // would throw without the providers

    releaseMe();
    // The probe reads both providers: it renders (rather than throwing) only if both are mounted.
    await waitFor(() => expect(screen.getByTestId("workouts-probe")).toHaveTextContent("function/function"));
  });

  it("the catalog is keyed by the signed-in user's id", async () => {
    server.use(...catalogHandlers([]));
    renderAt(["/app/workouts"]);

    // The probe forces a refresh on mount; a successful one persists under the provider's userId.
    await waitFor(() => expect(window.localStorage.getItem(`sin:catalog:v1:${ME.id}`)).not.toBeNull());
  });
});
