import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import {
  createMemoryRouter,
  RouterProvider,
  type InitialEntry,
} from "react-router";
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

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => auth.state,
}));

import { resetConfigCache } from "../config";
import { server } from "../test/msw/server";
import { catalogHandlers, createWorkoutFake } from "../test/workoutFake";
import { ProtectedRoute } from "./ProtectedRoute";
import { createRouter, makeOnRedirectCallback, routes } from "./router";

const CLIENT_ID = "spaClient123";
const API_BASE_URL = "https://api.example.test";
const AUDIENCE = "https://api.strengthinnumbers.app";
const ME_URL = `${API_BASE_URL}/v1/me`;

const ME = {
  id: "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c",
  email: "lifter@example.com",
  displayName: null,
  unitPreference: "kg",
  timezone: "Europe/London",
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

const problem = (body: Record<string, unknown>, status: number) =>
  new HttpResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

let meCalls = 0;
let lastMeHeaders: Headers | undefined;

beforeEach(() => {
  // jsdom keeps one session history for the whole file; #14's flag lives on it.
  window.history.replaceState(null, "");
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("VITE_AUTH0_AUDIENCE", AUDIENCE);
  vi.stubEnv("VITE_API_BASE_URL", API_BASE_URL);
  vi.stubEnv("VITE_APP_ENV", "staging");

  auth.state.isLoading = false;
  auth.state.isAuthenticated = false;
  auth.state.error = undefined;
  auth.state.loginWithRedirect = vi.fn();
  auth.state.logout = vi.fn();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");

  meCalls = 0;
  lastMeHeaders = undefined;
  // `/app` lands on Workouts (Spec 06.1): give it a "no active workout" API and an empty catalog.
  server.use(...createWorkoutFake().handlers, ...catalogHandlers([]));
  server.use(
    http.get(ME_URL, ({ request }) => {
      meCalls += 1;
      lastMeHeaders = request.headers;
      return HttpResponse.json(ME, { status: 200 });
    }),
  );
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
});

function renderAt(initialEntries: InitialEntry[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, ...utils };
}

describe("AC3 — Landing when unauthenticated and no prior session", () => {
  it("renders the value prop + exactly one control, no /v1 call, no redirect", async () => {
    const { router } = renderAt(["/"]);

    expect(await screen.findByTestId("landing")).toBeInTheDocument();
    expect(screen.getByText("Log your lifts. See the numbers move.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /log in/i }),
    ).toBeInTheDocument();

    expect(auth.state.loginWithRedirect).not.toHaveBeenCalled();
    expect(meCalls).toBe(0);
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("AC5 — login kicks off PKCE", () => {
  it("the Log in control calls loginWithRedirect once with the PKCE authorizationParams", async () => {
    renderAt(["/"]);
    await screen.findByTestId("landing");

    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1);
    expect(auth.state.loginWithRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        appState: { returnTo: "/app" },
        authorizationParams: expect.objectContaining({
          audience: AUDIENCE,
          redirect_uri: expect.stringMatching(/^https?:\/\/[^/]+\/callback$/),
          scope: expect.stringContaining("offline_access"),
        }),
      }),
    );
  });
});

describe("AC4 — session-resume bridge (routing)", () => {
  it("with the hint cookie set, calls loginWithRedirect(returnTo) and shows ResumingSession", async () => {
    document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;

    renderAt(["/"]);

    await waitFor(() => {
      expect(auth.state.loginWithRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          appState: { returnTo: "/app" },
          authorizationParams: expect.objectContaining({
            scope: expect.stringContaining("offline_access"),
          }),
        }),
      );
    });
    expect(screen.getByTestId("resuming-session")).toHaveTextContent(
      "Resuming your session…",
    );
    expect(screen.queryByTestId("landing")).toBeNull();
  });

  it("carries a deep-link returnTo from router state into loginWithRedirect", async () => {
    document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;

    renderAt([{ pathname: "/", state: { returnTo: "/app/history/123" } }]);

    await waitFor(() => {
      expect(auth.state.loginWithRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          appState: { returnTo: "/app/history/123" },
        }),
      );
    });
  });

  it("with the hint cookie cleared, renders Landing and never calls loginWithRedirect", async () => {
    renderAt(["/"]);

    expect(await screen.findByTestId("landing")).toBeInTheDocument();
    expect(auth.state.loginWithRedirect).not.toHaveBeenCalled();
  });

  it("?signin suppresses the auto-resume even with the hint cookie set (stale-cookie escape hatch)", async () => {
    document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;

    renderAt(["/?signin"]);

    expect(await screen.findByTestId("landing")).toBeInTheDocument();
    expect(auth.state.loginWithRedirect).not.toHaveBeenCalled();
  });

  it("ResumingSession offers a Go to sign in link to /?signin", async () => {
    document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;

    renderAt(["/"]);

    const link = await screen.findByRole("link", { name: /go to sign in/i });
    expect(link).toHaveAttribute("href", "/?signin");
  });

  describe("#14 — a raw browser Back from Universal Login does not resume again", () => {
    /** What the browser fires when it restores a page from the back/forward cache. */
    function pageshow(persisted: boolean): Event {
      const event = new Event("pageshow");
      Object.defineProperty(event, "persisted", { value: persisted });
      return event;
    }

    it("marks the / history entry before it redirects", async () => {
      document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;
      let stateAtRedirect: unknown;
      auth.state.loginWithRedirect = vi.fn(async () => {
        stateAtRedirect = window.history.state;
      });

      renderAt(["/"]);

      await waitFor(() => expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1));
      expect(stateAtRedirect).toMatchObject({ sinResumeAttempted: true });
    });

    it("on the real browser history, the mark survives the router's own writes and a reload of the entry shows Landing", async () => {
      // Production router (createBrowserRouter) over jsdom's real session history, entered on a deep
      // link: ProtectedRoute's <Navigate replace> rewrites the entry to `/` + state.returnTo, then
      // PublicEntry marks it. The memory-router tests above never touch window.history.
      document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;
      window.history.replaceState(null, "", "/app/history/1");
      const renderBrowser = () => {
        const router = createRouter();
        const utils = render(
          <QueryClientProvider client={new QueryClient()}>
            <RouterProvider router={router} />
          </QueryClientProvider>,
        );
        return { router, ...utils };
      };

      try {
        const first = renderBrowser();
        await waitFor(() => expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1));
        expect(auth.state.loginWithRedirect).toHaveBeenCalledWith(
          expect.objectContaining({ appState: { returnTo: "/app/history/1" } }),
        );
        expect(window.location.pathname).toBe("/");
        expect(window.history.state).toMatchObject({
          usr: { returnTo: "/app/history/1" },
          sinResumeAttempted: true,
        });

        // Arriving on the same entry again (a Back that reloads it, or a reload).
        first.unmount();
        first.router.dispose();
        const second = renderBrowser();
        expect(await screen.findByTestId("landing")).toBeInTheDocument();
        expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1);
        expect(window.history.state).toMatchObject({ sinResumeAttempted: true });
        second.unmount();
        second.router.dispose();
      } finally {
        window.history.replaceState(null, "", "/");
      }
    });

    it("its own mark does not flip the screen to Landing while the redirect is still leaving", async () => {
      document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;
      const { router } = renderAt(["/"]);
      await waitFor(() => expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1));

      // An ordinary re-render of the same mounted page (a location update, not a remount).
      await act(() => router.navigate("/", { replace: true, state: { returnTo: "/app" } }));

      expect(screen.getByTestId("resuming-session")).toBeInTheDocument();
      expect(screen.queryByTestId("landing")).toBeNull();
      expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1);
    });

    it("an entry a resume already left from shows Landing and never redirects (Back, or a reload of it)", async () => {
      document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;
      window.history.replaceState({ sinResumeAttempted: true }, "");

      renderAt(["/"]);

      expect(await screen.findByTestId("landing")).toBeInTheDocument();
      expect(screen.queryByTestId("resuming-session")).toBeNull();
      expect(auth.state.loginWithRedirect).not.toHaveBeenCalled();
    });

    it("a back/forward-cache restore of the resuming page re-renders as Landing", async () => {
      document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;
      renderAt(["/"]);
      await waitFor(() => expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("resuming-session")).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(pageshow(true));
      });

      expect(await screen.findByTestId("landing")).toBeInTheDocument();
      expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1);
    });

    it("an ordinary (non-cache) pageshow changes nothing, even with the entry marked", async () => {
      document.cookie = `auth0.${CLIENT_ID}.is.authenticated=true`;
      renderAt(["/"]);
      await waitFor(() => expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1));
      // The entry is marked now; only a cache restore (`persisted: true`) may re-read it.
      expect(window.history.state).toMatchObject({ sinResumeAttempted: true });

      act(() => {
        window.dispatchEvent(pageshow(false));
      });

      expect(screen.getByTestId("resuming-session")).toBeInTheDocument();
      expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1);
    });
  });

  it("sends an already-authenticated visitor of / straight to /app", async () => {
    auth.state.isAuthenticated = true;

    const { router } = renderAt(["/"]);

    expect(await screen.findByTestId("app-shell")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Start a workout" }); // let /app's redirect + Workouts load settle
    // `/app` redirects into Workouts (Spec 06.1 D20).
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });
});

describe("AC6 — callback completes or fails cleanly", () => {
  it("lands on a clean path (no code/state/error params) once the session resolves", async () => {
    auth.state.isAuthenticated = true;
    const { router } = renderAt(["/callback?code=abc&state=xyz"]);

    // AppRoot wires exactly this as the provider's onRedirectCallback.
    makeOnRedirectCallback(router)({ returnTo: "/app" });

    expect(await screen.findByTestId("app-shell")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Start a workout" }); // let /app's redirect + Workouts load settle
    // The clean path is `/app`, which redirects into Workouts (Spec 06.1 D20).
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
    expect(router.state.location.search).toBe("");
  });

  it("shows AuthError on ?error= and Try again returns to /?signin", async () => {
    const { router } = renderAt([
      "/callback?error=access_denied&error_description=Access%20denied",
    ]);

    expect(screen.getByTestId("auth-error")).toBeInTheDocument();
    expect(screen.getByTestId("auth-error-detail")).toHaveTextContent(
      "Access denied",
    );

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.location.search).toBe("?signin");
  });

  it("renders AuthError from a useAuth0().error", () => {
    auth.state.error = new Error("Invalid state parameter");
    renderAt(["/callback"]);

    expect(screen.getByTestId("auth-error")).toBeInTheDocument();
    expect(screen.getByTestId("auth-error-detail")).toHaveTextContent(
      "Invalid state parameter",
    );
  });

  it("bounces a direct visit with nothing to exchange to /", async () => {
    const { router } = renderAt(["/callback"]);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("renders AuthError with no detail when ?error= carries no description", () => {
    renderAt(["/callback?error=access_denied"]);
    expect(screen.getByTestId("auth-error")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-error-detail")).toBeNull();
  });
});

describe("makeOnRedirectCallback", () => {
  it("defaults to /app when appState has no returnTo", async () => {
    auth.state.isAuthenticated = true;
    const { router } = renderAt(["/callback?code=abc"]);

    makeOnRedirectCallback(router)();

    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    await screen.findByTestId("app-shell");
    await screen.findByRole("heading", { name: "Start a workout" }); // let /app's redirect + Workouts load settle
  });
});

describe("AC13 — protected routes capture returnTo in router state", () => {
  it("an unauthenticated visit to /app lands on / with state.returnTo = /app", async () => {
    const { router } = renderAt(["/app"]);

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.location.state).toEqual({ returnTo: "/app" });
  });

  it("captures a deep protected path (pathname + search)", async () => {
    const { router } = renderAt(["/app/history/123?tab=sets"]);

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.location.state).toEqual({
      returnTo: "/app/history/123?tab=sets",
    });
  });

  it("Landing's Log in control forwards the captured returnTo (fresh window, no hint cookie)", async () => {
    const { router } = renderAt(["/app/history/123?tab=sets"]);

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    fireEvent.click(await screen.findByRole("button", { name: /log in/i }));

    expect(auth.state.loginWithRedirect).toHaveBeenCalledTimes(1);
    expect(auth.state.loginWithRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        appState: { returnTo: "/app/history/123?tab=sets" },
      }),
    );
  });

  it("onRedirectCallback lands the user back on the captured deep path", async () => {
    auth.state.isAuthenticated = true;
    const { router } = renderAt(["/"]);

    await screen.findByTestId("app-shell");
    await screen.findByRole("heading", { name: "Start a workout" }); // let /app's redirect + Workouts load settle

    makeOnRedirectCallback(router)({ returnTo: "/app/history/123" });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/app/history/123"),
    );
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    // Spec 08.0: /app/history/:id is the workout summary; "123" is no workout, so let its 404 settle.
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
  });
});

describe("AC9 — session bootstrap order", () => {
  it("issues exactly one GET /v1/me (Bearer + X-Request-Id) and renders the frame only after 200", async () => {
    auth.state.isAuthenticated = true;
    renderAt(["/app"]); // no StrictMode

    // Frame is gated on the request resolving.
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell")).toBeNull();

    expect(await screen.findByTestId("app-shell")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Start a workout" }); // let /app's redirect + Workouts load settle
    expect(screen.getByTestId("app-shell-user")).toHaveTextContent(
      "lifter@example.com",
    );

    expect(meCalls).toBe(1); // ProtectedLayout + AppShell share ["me"]
    expect(lastMeHeaders?.get("authorization")).toMatch(/^Bearer .+/);
    expect(lastMeHeaders?.get("x-request-id") ?? "").not.toBe("");
  });

  it("renders the frame for an isNewUser: true body", async () => {
    auth.state.isAuthenticated = true;
    server.use(
      http.get(ME_URL, () => {
        meCalls += 1;
        return HttpResponse.json({ ...ME, isNewUser: true }, { status: 200 });
      }),
    );

    renderAt(["/app"]);

    expect(await screen.findByTestId("app-shell")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Start a workout" }); // let /app's redirect + Workouts load settle
    expect(screen.getByTestId("app-shell-user")).toHaveTextContent(
      "lifter@example.com",
    );
    expect(meCalls).toBe(1);
  });
});

describe("AC10 — bootstrap failure modes", () => {
  it("403 account-deleted -> AccountDeleted + logout", async () => {
    auth.state.isAuthenticated = true;
    server.use(
      http.get(ME_URL, () =>
        problem(
          {
            type: "https://strengthinnumbers.app/problems/account-deleted",
            title: "Account deleted",
            status: 403,
            detail: "This account has been deleted.",
            instance: "req-1",
          },
          403,
        ),
      ),
    );

    renderAt(["/app"]);

    expect(await screen.findByTestId("account-deleted")).toBeInTheDocument();
    await waitFor(() =>
      expect(auth.state.logout).toHaveBeenCalledWith({
        logoutParams: { returnTo: window.location.origin },
      }),
    );
  });

  it("503 auth-unavailable -> RetryScreen, no logout", async () => {
    auth.state.isAuthenticated = true;
    server.use(
      http.get(ME_URL, () =>
        problem(
          {
            type: "https://strengthinnumbers.app/problems/auth-unavailable",
            title: "Authentication temporarily unavailable",
            status: 503,
            detail: "Unable to validate credentials right now.",
            instance: "req-2",
          },
          503,
        ),
      ),
    );

    renderAt(["/app"]);

    expect(await screen.findByTestId("retry-screen")).toBeInTheDocument();
    // The correlation id shown is the client-sent X-Request-Id (a UUID the API
    // echoes), not the problem body's `instance`.
    expect(screen.getByTestId("retry-request-id")).toHaveTextContent(
      /Reference: [0-9a-f-]{36}/i,
    );
    expect(auth.state.logout).not.toHaveBeenCalled();
  });

  it("network error -> RetryScreen, no logout", async () => {
    auth.state.isAuthenticated = true;
    server.use(http.get(ME_URL, () => HttpResponse.error()));

    renderAt(["/app"]);

    expect(await screen.findByTestId("retry-screen")).toBeInTheDocument();
    expect(auth.state.logout).not.toHaveBeenCalled();
  });

  it("Try again issues a fresh GET /v1/me", async () => {
    auth.state.isAuthenticated = true;
    let attempt = 0;
    server.use(
      http.get(ME_URL, () => {
        attempt += 1;
        return attempt === 1
          ? problem(
              {
                type: "https://strengthinnumbers.app/problems/auth-unavailable",
                title: "Authentication temporarily unavailable",
                status: 503,
                detail: "…",
                instance: "req-3",
              },
              503,
            )
          : HttpResponse.json(ME, { status: 200 });
      }),
    );

    renderAt(["/app"]);

    expect(await screen.findByTestId("retry-screen")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByTestId("app-shell")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Start a workout" }); // let /app's redirect + Workouts load settle
    expect(attempt).toBe(2);
  });
});

describe("Bootstrap gate — isLoading", () => {
  it("shows the spinner and no route content or redirect while isLoading", async () => {
    auth.state.isLoading = true;
    const { router } = renderAt(["/app/history/123"]);

    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell")).toBeNull();
    expect(screen.queryByTestId("landing")).toBeNull();
    expect(router.state.location.pathname).toBe("/app/history/123");
    expect(auth.state.loginWithRedirect).not.toHaveBeenCalled();
    expect(meCalls).toBe(0);

    await Promise.resolve();
    expect(router.state.location.pathname).toBe("/app/history/123");
  });
});

describe("ProtectedRoute — isLoading branch", () => {
  it("renders the spinner directly when the SDK is still loading", () => {
    auth.state.isLoading = true;
    const router = createMemoryRouter(
      [
        {
          path: "/app",
          element: <ProtectedRoute />,
          children: [{ index: true, element: <div data-testid="child" /> }],
        },
      ],
      { initialEntries: ["/app"] },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("child")).toBeNull();
  });
});
