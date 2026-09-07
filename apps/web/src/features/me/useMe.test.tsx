import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: auth.getAccessTokenSilently,
    logout: auth.logout,
  }),
}));

import { resetConfigCache } from "../../config";
import { server } from "../../test/msw/server";
import { useMe } from "./useMe";

const API_BASE_URL = "https://api.example.test";
const ME = {
  id: "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c",
  email: "lifter@example.com",
  displayName: null,
  unitPreference: "kg",
  timezone: "Europe/London",
  createdAt: "2026-01-01T00:00:00.000Z",
};

let meCalls = 0;

beforeEach(() => {
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "spaClient123");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.strengthinnumbers.app");
  vi.stubEnv("VITE_API_BASE_URL", API_BASE_URL);
  vi.stubEnv("VITE_APP_ENV", "staging");
  auth.getAccessTokenSilently.mockReset().mockResolvedValue("test-token");

  meCalls = 0;
  server.use(
    http.get(`${API_BASE_URL}/v1/me`, () => {
      meCalls += 1;
      return HttpResponse.json(ME, { status: 200 });
    }),
  );
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

function Consumer({ testid }: { testid: string }) {
  const { data, isSuccess } = useMe();
  return <div data-testid={testid}>{isSuccess ? data.email : "pending"}</div>;
}

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("AC9 — useMe shares the [\"me\"] key", () => {
  it("two consumers in the tree dedupe to a single GET /v1/me", async () => {
    wrap(
      <>
        <Consumer testid="a" />
        <Consumer testid="b" />
      </>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("a")).toHaveTextContent("lifter@example.com"),
    );
    expect(screen.getByTestId("b")).toHaveTextContent("lifter@example.com");
    expect(meCalls).toBe(1);
  });

  it("validates the body against MeSchema and exposes the typed data", async () => {
    wrap(<Consumer testid="only" />);

    await waitFor(() =>
      expect(screen.getByTestId("only")).toHaveTextContent(
        "lifter@example.com",
      ),
    );
  });
});
