import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
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

const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../observability/reportError", () => ({
  reportError: observability.reportError,
}));

import { resetConfigCache } from "../config";
import { AppErrorBoundary, RootErrorBoundary } from "./RootErrorBoundary";
import { routes } from "./router";

const BOOM = new Error("render exploded");

function Boom(): never {
  throw BOOM;
}

// React logs caught render errors to console.error; keep the test output
// readable without hiding assertion failures.
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "spaClient123");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.strengthinnumbers.app");
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
  vi.stubEnv("VITE_APP_ENV", "staging");
  observability.reportError.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  resetConfigCache();
  vi.unstubAllEnvs();
});

/** The real route table plus one public child that throws on render. */
function routesWithBoom(): RouteObject[] {
  const [root, ...rest] = routes;
  if (!root || root.index) throw new Error("unexpected root route shape");
  const boom: RouteObject = { path: "/boom", element: <Boom /> };
  const withBoom: RouteObject = {
    ...root,
    children: [...(root.children ?? []), boom],
  };
  return [withBoom, ...rest];
}

describe("AC8 — error boundary (Spec 04.1 §2 / §6.4)", () => {
  it("the root route registers RootErrorBoundary as its errorElement", () => {
    const [root] = routes;
    expect(root?.errorElement).toBeDefined();
  });

  it("a route element that throws on render → our fallback, not React Router's default page; reportError called once", () => {
    const router = createMemoryRouter(routesWithBoom(), {
      initialEntries: ["/boom"],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("error-fallback")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Something broke" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByText(/unexpected application error/i)).toBeNull();

    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError).toHaveBeenCalledWith(BOOM, {
      boundary: "root",
    });
  });

  it("RootErrorBoundary does not re-report the same error on re-render", () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <Boom />, errorElement: <RootErrorBoundary /> }],
      { initialEntries: ["/"] },
    );
    const { rerender } = render(<RouterProvider router={router} />);
    rerender(<RouterProvider router={router} />);

    expect(observability.reportError).toHaveBeenCalledTimes(1);
  });

  it("AppErrorBoundary catches an error thrown outside the router and reports it once", () => {
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(screen.getByTestId("error-fallback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError).toHaveBeenCalledWith(BOOM, {
      boundary: "app",
    });
  });

  it("AppErrorBoundary renders its children when nothing throws", () => {
    render(
      <AppErrorBoundary>
        <p>fine</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
    expect(screen.queryByTestId("error-fallback")).toBeNull();
    expect(observability.reportError).not.toHaveBeenCalled();
  });
});
