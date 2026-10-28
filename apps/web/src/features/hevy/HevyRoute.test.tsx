import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { routes } from "../../app/router";
import { API_BASE_URL, ME, ME_URL, makeQueryClient, stubAccountEnv, unstubAccountEnv } from "../../test/accountHarness";
import { server } from "../../test/msw/server";
import { catalogHandlers, createWorkoutFake } from "../../test/workoutFake";
import { HEVY_PATH } from "./paths";

const STATUS_URL = `${API_BASE_URL}/v1/hevy/status`;

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  server.use(...createWorkoutFake().handlers, ...catalogHandlers([]), http.get(ME_URL, () => HttpResponse.json(ME)));
});
afterEach(() => unstubAccountEnv());

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("20.0 AC1 — direct visit", () => {
  it("a 404 status is the not-found screen", async () => {
    renderAt(HEVY_PATH);
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hevy" })).toBeNull();
  });

  it("an enabled status is the Hevy screen with its back link", async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.json({ enabled: true, pairCount: 0, linkCount: 0, recordsStale: false })));
    renderAt(HEVY_PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Hevy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Profile" })).toHaveAttribute("href", "/app/profile");
  });

  it("a failed background refetch after a success keeps the screen (a network blip is not 'not found')", async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.json({ enabled: true, pairCount: 0, linkCount: 0, recordsStale: false })));
    const queryClient = makeQueryClient();
    const router = createMemoryRouter(routes, { initialEntries: [HEVY_PATH] });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Hevy" })).toBeInTheDocument();

    server.use(http.get(STATUS_URL, () => HttpResponse.error()));
    await queryClient.refetchQueries({ queryKey: ["hevy", "status"] });
    expect(queryClient.getQueryState(["hevy", "status"])?.status).toBe("error");
    // Let React render the errored state before asserting.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.getByRole("heading", { level: 1, name: "Hevy" })).toBeInTheDocument();
    expect(screen.queryByTestId("not-found")).toBeNull();
  });

  it("offline, with no status yet, it says so instead of spinning or claiming not found", async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.error()));
    renderAt(HEVY_PATH);
    expect(await screen.findByText("Couldn't load this page. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByTestId("not-found")).toBeNull();
    expect(screen.queryByTestId("spinner")).toBeNull();
    // The gate hides the feature from everyone else, so nothing here names it.
    expect(screen.getByRole("main", { hidden: true }).textContent ?? "").not.toMatch(/hevy/i);
  });

  it("while the status is pending it shows a spinner, never the screen", async () => {
    server.use(http.get(STATUS_URL, () => new Promise<never>(() => {})));
    renderAt(HEVY_PATH);
    // The status read is pending: the gate's spinner, after the shell's own loading has settled.
    await screen.findByRole("navigation");
    expect(await screen.findByTestId("spinner")).toHaveTextContent("Loading…");
    expect(screen.queryByRole("heading", { name: "Hevy" })).toBeNull();
    expect(screen.queryByTestId("not-found")).toBeNull();
  });
});
