import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const tz = vi.hoisted(() => ({
  zones: ["Europe/London", "America/Chicago", "Asia/Tokyo"] as
    | readonly string[]
    | undefined,
}));
vi.mock("./timeZones", () => ({ listTimeZones: () => tz.zones }));

const observability = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));

import { routes } from "../../app/router";
import { resetConfigCache } from "../../config";
import { server } from "../../test/msw/server";
import { ME_QUERY_KEY } from "./useMe";

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

const problem = (body: Record<string, unknown>, status: number) =>
  new HttpResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

let getCalls = 0;
let patchBodies: unknown[] = [];

beforeEach(() => {
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "spaClient123");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.strengthinnumbers.app");
  vi.stubEnv("VITE_API_BASE_URL", API_BASE_URL);
  vi.stubEnv("VITE_APP_ENV", "staging");

  auth.state.isAuthenticated = true;
  auth.state.logout = vi.fn();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  tz.zones = ["Europe/London", "America/Chicago", "Asia/Tokyo"];
  observability.track.mockReset();

  getCalls = 0;
  patchBodies = [];
  server.use(
    http.get(ME_URL, () => {
      getCalls += 1;
      return HttpResponse.json(ME, { status: 200 });
    }),
    http.patch(ME_URL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patchBodies.push(body);
      return HttpResponse.json({ ...ME, ...body }, { status: 200 });
    }),
  );
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

function renderProfile() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: ["/app/profile"] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

const form = async () => within(await screen.findByTestId("profile-form"));
const user = () => userEvent.setup();

describe("AC5 — Profile loads current values (Spec 04.1 §2)", () => {
  it("renders displayName, unit <select> from UNIT_PREFERENCE_VALUES, and timezone <select> with the current values selected", async () => {
    renderProfile();
    const f = await form();

    expect(f.getByLabelText("Display name")).toHaveValue("Sam");

    const units = f.getByLabelText("Units") as HTMLSelectElement;
    expect([...units.options].map((o) => o.value)).toEqual(["kg", "lb"]);
    expect(units).toHaveValue("kg");

    const zone = f.getByLabelText("Time zone") as HTMLSelectElement;
    expect(zone.tagName).toBe("SELECT");
    expect([...zone.options].map((o) => o.value)).toEqual(tz.zones);
    expect(zone).toHaveValue("Europe/London");
  });

  it("keeps a stored timezone that is not in the host list as a selected extra option", async () => {
    server.use(
      http.get(ME_URL, () =>
        HttpResponse.json({ ...ME, timezone: "Europe/Kyiv" }, { status: 200 }),
      ),
    );
    renderProfile();
    const f = await form();

    const zone = f.getByLabelText("Time zone") as HTMLSelectElement;
    expect(zone).toHaveValue("Europe/Kyiv");
    expect([...zone.options].map((o) => o.value)).toEqual([
      "Europe/Kyiv",
      ...(tz.zones ?? []),
    ]);
  });

  it("falls back to a text input when the host has no time-zone list", async () => {
    tz.zones = undefined;
    renderProfile();
    const f = await form();

    const zone = f.getByLabelText("Time zone");
    expect(zone.tagName).toBe("INPUT");
    expect(zone).toHaveValue("Europe/London");
  });

  it("shows the spinner, not an empty form, while the me query is pending", async () => {
    server.use(http.get(ME_URL, () => new Promise<never>(() => {})));
    renderProfile();

    expect(await screen.findByTestId("spinner")).toBeInTheDocument();
    await Promise.resolve();
    expect(screen.queryByTestId("profile-form")).toBeNull();
    expect(screen.queryByLabelText("Display name")).toBeNull();
  });
});

describe("AC6 — Profile saves (Spec 04.1 §2)", () => {
  it("PATCHes only the changed field, writes the cache, and the shell header updates with no refetch", async () => {
    const { queryClient } = renderProfile();
    const f = await form();
    const u = user();

    expect(screen.getByTestId("app-shell-user")).toHaveTextContent("Sam");
    expect(f.getByRole("button", { name: "Save" })).toBeDisabled(); // nothing dirty

    await u.clear(f.getByLabelText("Display name"));
    await u.type(f.getByLabelText("Display name"), "Samira");
    await u.click(f.getByRole("button", { name: "Save" }));

    await screen.findByTestId("profile-saved");
    expect(patchBodies).toEqual([{ displayName: "Samira" }]);

    expect(queryClient.getQueryData(ME_QUERY_KEY)).toEqual({
      ...ME,
      displayName: "Samira",
    });
    expect(screen.getByTestId("app-shell-user")).toHaveTextContent("Samira");
    expect(getCalls).toBe(1); // no refetch — the cache write is the update
    expect(observability.track).toHaveBeenCalledWith("profile_saved");
    expect(f.getByRole("button", { name: "Save" })).toBeDisabled(); // clean again
  });

  it("clearing displayName sends null", async () => {
    renderProfile();
    const f = await form();
    const u = user();

    await u.clear(f.getByLabelText("Display name"));
    await u.click(f.getByRole("button", { name: "Save" }));

    await screen.findByTestId("profile-saved");
    expect(patchBodies).toEqual([{ displayName: null }]);
    expect(screen.getByTestId("app-shell-user")).toHaveTextContent("lifter@example.com");
  });

  it("sends several changed fields together and nothing unchanged", async () => {
    renderProfile();
    const f = await form();
    const u = user();

    await u.selectOptions(f.getByLabelText("Units"), "lb");
    await u.selectOptions(f.getByLabelText("Time zone"), "Asia/Tokyo");
    await u.click(f.getByRole("button", { name: "Save" }));

    await screen.findByTestId("profile-saved");
    expect(patchBodies).toEqual([{ unitPreference: "lb", timezone: "Asia/Tokyo" }]);
  });

  it("the Log out control calls Auth0 logout with the site origin", async () => {
    renderProfile();
    await form();

    await user().click(screen.getByRole("button", { name: "Log out" }));

    expect(auth.state.logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });
});

describe("AC7 — Profile validation errors (Spec 04.1 §2)", () => {
  it("422 with a field path → inline message under that Field only, value not echoed", async () => {
    server.use(
      http.patch(ME_URL, () =>
        problem(
          {
            type: "https://strengthinnumbers.app/problems/validation-error",
            title: "Validation failed",
            status: 422,
            detail: "The request body failed validation.",
            instance: "req-1",
            errors: [{ path: "displayName", message: "is too long" }],
          },
          422,
        ),
      ),
    );
    renderProfile();
    const f = await form();
    const u = user();

    await u.type(f.getByLabelText("Display name"), "XYZZY");
    await u.click(f.getByRole("button", { name: "Save" }));

    const alert = await f.findByRole("alert");
    expect(alert).toHaveTextContent("is too long");
    expect(alert).not.toHaveTextContent("XYZZY");
    expect(alert).toHaveAttribute("id", "displayName-error");
    expect(f.getByLabelText("Display name")).toHaveAttribute("aria-invalid", "true");
    expect(f.getByLabelText("Units")).not.toHaveAttribute("aria-invalid");
    expect(f.getByLabelText("Time zone")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByTestId("profile-form-error")).toBeNull();
    expect(screen.queryByTestId("profile-saved")).toBeNull();
  });

  it("422 with a (body) path → form-level message, no field marked", async () => {
    server.use(
      http.patch(ME_URL, () =>
        problem(
          {
            type: "https://strengthinnumbers.app/problems/validation-error",
            title: "Validation failed",
            status: 422,
            detail: "The request body failed validation.",
            instance: "req-2",
            errors: [{ path: "(body)", message: "is not a recognized field" }],
          },
          422,
        ),
      ),
    );
    renderProfile();
    const f = await form();
    const u = user();

    await u.selectOptions(f.getByLabelText("Units"), "lb");
    await u.click(f.getByRole("button", { name: "Save" }));

    const formError = await screen.findByTestId("profile-form-error");
    expect(formError).toHaveTextContent("is not a recognized field");
    for (const label of ["Display name", "Units", "Time zone"]) {
      expect(f.getByLabelText(label)).not.toHaveAttribute("aria-invalid");
    }
  });

  it("a 503 → single form-level message carrying the requestId", async () => {
    server.use(
      http.patch(ME_URL, () =>
        problem(
          {
            type: "https://strengthinnumbers.app/problems/auth-unavailable",
            title: "Service unavailable",
            status: 503,
            detail: "Try again shortly.",
            instance: "req-3",
          },
          503,
        ),
      ),
    );
    renderProfile();
    const f = await form();
    const u = user();

    await u.selectOptions(f.getByLabelText("Units"), "lb");
    await u.click(f.getByRole("button", { name: "Save" }));

    const formError = await screen.findByTestId("profile-form-error");
    expect(formError).toHaveTextContent(/Reference: [0-9a-f-]{36}/);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(f.getByLabelText("Units")).not.toHaveAttribute("aria-invalid");
    // The failed save leaves the form dirty so the user can retry.
    await waitFor(() =>
      expect(f.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
  });

  it("editing a field clears its inline error", async () => {
    server.use(
      http.patch(ME_URL, () =>
        problem(
          {
            type: "https://strengthinnumbers.app/problems/validation-error",
            title: "Validation failed",
            status: 422,
            detail: "The request body failed validation.",
            instance: "req-4",
            errors: [{ path: "timezone", message: "must be a valid IANA time zone" }],
          },
          422,
        ),
      ),
    );
    tz.zones = undefined; // text input so we can type an invalid zone
    renderProfile();
    const f = await form();
    const u = user();

    await u.clear(f.getByLabelText("Time zone"));
    await u.type(f.getByLabelText("Time zone"), "Mars/Olympus");
    await u.click(f.getByRole("button", { name: "Save" }));
    await f.findByRole("alert");

    await u.type(f.getByLabelText("Time zone"), "_Mons");
    expect(f.queryByRole("alert")).toBeNull();
    expect(f.getByLabelText("Time zone")).not.toHaveAttribute("aria-invalid");
  });
});
