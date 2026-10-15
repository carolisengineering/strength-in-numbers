import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { ACCOUNT_URL, EXPORT_URL, ME, ME_URL, deleteOk, makeQueryClient, problem, stubAccountEnv, unstubAccountEnv } from "../test/accountHarness";
import { server } from "../test/msw/server";
import { catalogHandlers, createWorkoutFake } from "../test/workoutFake";
import { routes } from "./router";

let requests: string[] = [];
beforeEach(() => {
  stubAccountEnv();
  auth.state.isAuthenticated = true;
  auth.state.logout = vi.fn();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  requests = [];
  server.events.on("request:start", ({ request }) => { requests.push(`${request.method} ${new URL(request.url).pathname}`); });
  server.use(...createWorkoutFake().handlers, ...catalogHandlers([]), http.get(ME_URL, () => HttpResponse.json(ME)));
});
afterEach(() => {
  server.events.removeAllListeners();
  unstubAccountEnv();
});

function renderApp(queryClient = makeQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: ["/app/profile"] });
  const view = render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
  return { queryClient, unmount: view.unmount };
}

/** Drive the real flow (Task 7's UI): open → Continue → wait out the settle window → Delete my account. */
async function deleteThroughTheDialog() {
  await userEvent.click(await screen.findByRole("button", { name: "Delete account…" }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  const confirm = screen.getByRole("button", { name: "Delete my account" });
  await waitFor(() => expect(confirm).toBeEnabled(), { timeout: 2000 });
  await userEvent.click(confirm);
}

describe("12 AC20 — after the 202 the app stops talking to /v1", () => {
  it("replaces the shell with the confirmation, and makes no further request on timers, focus or online events", async () => {
    server.use(deleteOk());
    const { queryClient } = renderApp();
    await deleteThroughTheDialog();

    expect(await screen.findByRole("heading", { name: "Your account is scheduled for deletion" })).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell-user")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();

    await act(async () => {}); // let the confirmation's mount effect cancel and remove queries
    // The mechanism, not a timing window: refetch-on-focus / on-reconnect / intervals all act on queries
    // that are active (have an enabled observer). The only query left is ProtectedLayout's own `["me"]`,
    // held by its `enabled: false` observer: inactive and idle, so nothing can refetch it.
    const left = queryClient.getQueryCache().getAll();
    expect(left.filter((q) => q.isActive() || q.state.fetchStatus !== "idle").map((q) => q.queryKey)).toEqual([]);
    expect(left.map((q) => q.queryKey)).toEqual([["me"]]);
    expect(queryClient.isFetching()).toBe(0);

    const before = requests.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(requests.slice(before)).toEqual([]);
  });

  it("does NOT refetch /v1/me when the confirmation signs out (no useSession inside it)", async () => {
    server.use(deleteOk());
    renderApp();
    await deleteThroughTheDialog();
    await screen.findByRole("heading", { name: "Your account is scheduled for deletion" });
    await act(async () => {});
    const meBefore = requests.filter((r) => r === "GET /v1/me").length;
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(requests.filter((r) => r === "GET /v1/me").length).toBe(meBefore);
    expect(auth.state.logout).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirmation after the Profile route remounts (the result lives in the mutation cache)", async () => {
    server.use(deleteOk());
    const { queryClient, unmount } = renderApp();
    await deleteThroughTheDialog();
    await screen.findByRole("heading", { name: "Your account is scheduled for deletion" });
    await act(async () => {});

    unmount(); // the whole route tree (Profile, ProtectedLayout) goes away…
    const before = requests.length;
    renderApp(queryClient); // …and comes back on the same QueryClient, as a re-render of the app would

    expect(await screen.findByRole("heading", { name: "Your account is scheduled for deletion" })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(requests.slice(before)).toEqual([]); // the gate came from the mutation cache, not from GET /v1/me
  });
});

describe("12 AC10 — a 403 account-deleted from an account call lands on AccountDeleted", () => {
  it("export 403: no notice; the me refetch (also 403) renders the closed-account screen", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Download my data" });
    server.use(
      http.get(EXPORT_URL, () => problem(403, "account-deleted")),
      http.get(ME_URL, () => problem(403, "account-deleted")),
    );
    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));
    expect(await screen.findByTestId("account-deleted")).toBeInTheDocument();
  });

  it("delete 403 (already deleted elsewhere) is 'done' and lands on AccountDeleted", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Delete account…" });
    server.use(
      http.delete(ACCOUNT_URL, () => problem(403, "account-deleted")),
      http.get(ME_URL, () => problem(403, "account-deleted")),
    );
    await deleteThroughTheDialog();
    expect(await screen.findByTestId("account-deleted")).toBeInTheDocument();
  });
});
