import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { API_BASE_URL, renderProfile, stubAccountEnv, unstubAccountEnv } from "../../test/accountHarness";
import { server } from "../../test/msw/server";
import { HEVY_KEYS } from "./keys";
import { HEVY_PATH } from "./paths";

const STATUS_URL = `${API_BASE_URL}/v1/hevy/status`;
const ENABLED = { enabled: true, pairCount: 0, linkCount: 0, recordsStale: false };

let statusCalls = 0;
beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  statusCalls = 0;
  server.events.on("request:start", ({ request }) => {
    if (new URL(request.url).pathname === "/v1/hevy/status") statusCalls += 1;
  });
});
afterEach(() => {
  server.events.removeAllListeners();
  unstubAccountEnv();
});

/** Waits for the status read to settle (it is the only request Profile makes here). */
async function settled() {
  await waitFor(() => expect(statusCalls).toBe(1));
  await new Promise((r) => setTimeout(r, 20));
}
const noHevy = () => {
  expect(screen.queryByText(/hevy/i)).toBeNull();
  expect(document.querySelector(`a[href="${HEVY_PATH}"]`)).toBeNull();
};

describe("20.0 AC1 — hidden by default", () => {
  it("the default 404 shows no Hevy row", async () => {
    renderProfile();
    await settled();
    noHevy();
  });

  it("a network failure shows no Hevy row", async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.error()));
    renderProfile();
    await settled();
    noHevy();
  });

  it("while the status is pending there is no Hevy row", async () => {
    server.use(http.get(STATUS_URL, () => new Promise<never>(() => {})));
    renderProfile();
    await waitFor(() => expect(statusCalls).toBe(1));
    noHevy();
  });

  it("an enabled status shows one Hevy link to the Hevy screen, from one request under [hevy, status]", async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.json(ENABLED)));
    const { queryClient } = renderProfile();
    const link = await screen.findByRole("link", { name: /Hevy/ });
    expect(link).toHaveAttribute("href", HEVY_PATH);
    expect(statusCalls).toBe(1);
    expect(HEVY_KEYS.status).toEqual(["hevy", "status"]);
    expect(queryClient.getQueryData(HEVY_KEYS.status)).toEqual(ENABLED);
  });
});
