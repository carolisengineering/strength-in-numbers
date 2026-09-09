import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { ProtectedRoute } from "./ProtectedRoute";
import { makeOnRedirectCallback, routes } from "./router";

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

  it("sends an already-authenticated visitor of / straight to /app", async () => {
    auth.state.isAuthenticated = true;

    const { router } = renderAt(["/"]);

    expect(await screen.findByTestId("authed-placeholder")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app");
  });
});

describe("AC6 — callback completes or fails cleanly", () => {
  it("lands on a clean path (no code/state/error params) once the session resolves", async () => {
    auth.state.isAuthenticated = true;
    const { router } = renderAt(["/callback?code=abc&state=xyz"]);

    // AppRoot wires exactly this as the provider's onRedirectCallback.
    makeOnRedirectCallback(router)({ returnTo: "/app" });

    expect(await screen.findByTestId("authed-placeholder")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app");
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
    await screen.findByTestId("authed-placeholder");
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

    await screen.findByTestId("authed-placeholder");

    makeOnRedirectCallback(router)({ returnTo: "/app/history/123" });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/app/history/123"),
    );
    expect(screen.getByTestId("authed-placeholder")).toBeInTheDocument();
  });
});

describe("AC9 — session bootstrap order", () => {
  it("issues exactly one GET /v1/me (Bearer + X-Request-Id) and renders the frame only after 200", async () => {
    auth.state.isAuthenticated = true;
    renderAt(["/app"]); // no StrictMode

    // Frame is gated on the request resolving.
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("authed-placeholder")).toBeNull();

    expect(await screen.findByTestId("authed-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("authed-email")).toHaveTextContent(
      "lifter@example.com",
    );

    expect(meCalls).toBe(1); // ProtectedLayout + AuthedPlaceholder share ["me"]
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

    expect(await screen.findByTestId("authed-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("authed-email")).toHaveTextContent(
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

    expect(await screen.findByTestId("authed-placeholder")).toBeInTheDocument();
    expect(attempt).toBe(2);
  });
});

describe("Bootstrap gate — isLoading", () => {
  it("shows the spinner and no route content or redirect while isLoading", async () => {
    auth.state.isLoading = true;
    const { router } = renderAt(["/app/history/123"]);

    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("authed-placeholder")).toBeNull();
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
