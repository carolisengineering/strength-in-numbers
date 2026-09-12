import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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
import { NAV_ITEMS } from "./navItems";
import { routes } from "./router";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_BASE_URL = "https://api.example.test";
const ME_URL = `${API_BASE_URL}/v1/me`;

const ME = {
  id: "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c",
  email: "lifter@example.com",
  displayName: "Sam",
  unitPreference: "kg",
  timezone: "Europe/London",
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

/** Never resolves — holds the `me` query in `pending`. */
const meNeverResolves = () => new Promise<never>(() => {});

beforeEach(() => {
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "spaClient123");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.strengthinnumbers.app");
  vi.stubEnv("VITE_API_BASE_URL", API_BASE_URL);
  vi.stubEnv("VITE_APP_ENV", "staging");

  auth.state.isLoading = false;
  auth.state.isAuthenticated = false;
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");

  server.use(http.get(ME_URL, () => HttpResponse.json(ME, { status: 200 })));
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

function renderAt(initialEntries: InitialEntry[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

// Vitest loads no CSS in this config, so AC2 is asserted on the stylesheet
// *source* (Spec 04.1 §10): the rule text is the contract; real computed
// geometry is the M1 e2e's job.
describe("AC2 — thumb-zone shell (Spec 04.1 §2)", () => {
  const shellCss = readFileSync(join(HERE, "AppShell.module.css"), "utf8");
  const tokensCss = readFileSync(join(HERE, "..", "ui", "tokens.css"), "utf8");

  const rule = (css: string, selector: string) =>
    css.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ??
    "";

  it("sizes every nav target to var(--tap-target-min) in both axes", () => {
    const target = rule(shellCss, ".navTarget");
    expect(target).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    expect(target).toMatch(/min-width:\s*var\(--tap-target-min\)/);
  });

  it("pads the nav bottom with env(safe-area-inset-bottom)", () => {
    const nav = rule(shellCss, ".nav");
    expect(nav).toMatch(/padding-bottom:[^;]*env\(safe-area-inset-bottom\)/);
  });

  it("tokens.css resolves --tap-target-min to 44px", () => {
    expect(tokensCss).toMatch(/--tap-target-min:\s*44px/);
  });

  it("renders a single bottom nav with one link per registry item, in order", async () => {
    auth.state.isAuthenticated = true;
    renderAt(["/app"]);
    await screen.findByTestId("app-shell");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(
      NAV_ITEMS.map((i) => i.to),
    );
    expect(links.map((l) => l.textContent)).toEqual(
      NAV_ITEMS.map((i) => (i.comingSoon ? `${i.label}·` : i.label)),
    );
  });
});

describe("AC3 — shell mounts only when authed + bootstrapped (Spec 04.1 §2)", () => {
  it("authenticated + 200 /v1/me at /app/profile → shell with displayName in the header", async () => {
    auth.state.isAuthenticated = true;
    renderAt(["/app/profile"]);

    const shell = await screen.findByTestId("app-shell");
    const user = within(shell).getByTestId("app-shell-user");
    expect(user).toHaveTextContent("Sam");
    expect(user).toHaveAttribute("href", "/app/profile");
    expect(within(shell).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Profile",
    );
    // NavLink marks the current section.
    expect(
      within(screen.getByRole("navigation")).getByRole("link", {
        name: /profile/i,
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("falls back to email in the header when displayName is null", async () => {
    auth.state.isAuthenticated = true;
    server.use(
      http.get(ME_URL, () =>
        HttpResponse.json({ ...ME, displayName: null }, { status: 200 }),
      ),
    );
    renderAt(["/app"]);

    expect(await screen.findByTestId("app-shell-user")).toHaveTextContent(
      "lifter@example.com",
    );
  });

  it("unauthenticated visit to /app/profile → redirected to /, shell never mounts", async () => {
    const { router } = renderAt(["/app/profile"]);

    expect(await screen.findByTestId("landing")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByTestId("app-shell")).toBeNull();
  });

  it("me query pending → spinner, no shell", async () => {
    auth.state.isAuthenticated = true;
    server.use(http.get(ME_URL, meNeverResolves));
    renderAt(["/app/profile"]);

    expect(await screen.findByTestId("spinner")).toBeInTheDocument();
    await Promise.resolve();
    expect(screen.queryByTestId("app-shell")).toBeNull();
  });

  it("unknown /app/* path → NotFound inside the shell", async () => {
    auth.state.isAuthenticated = true;
    renderAt(["/app/nope"]);

    const shell = await screen.findByTestId("app-shell");
    expect(within(shell).getByTestId("not-found")).toBeInTheDocument();
    expect(within(shell).getByRole("link", { name: /go to the app/i })).toHaveAttribute(
      "href",
      "/app",
    );
  });

  it("unknown top-level path, unauthenticated → NotFound with no shell", async () => {
    renderAt(["/nope"]);

    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell")).toBeNull();
    expect(screen.queryByTestId("landing")).toBeNull();
  });

  it("coming-soon sections render the stub under their section title", async () => {
    auth.state.isAuthenticated = true;
    renderAt(["/app/history"]);

    await screen.findByTestId("coming-soon");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("History");
  });
});
