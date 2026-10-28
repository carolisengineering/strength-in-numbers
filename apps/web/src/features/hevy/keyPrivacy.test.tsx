import { render, screen, within } from "@testing-library/react";
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

const reported = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../../observability/reportError", () => ({ reportError: (...args: unknown[]) => void reported.calls.push(args) }));

import { RootErrorBoundary } from "../../app/RootErrorBoundary";
import { stubAccountEnv, unstubAccountEnv } from "../../test/accountHarness";
import { HEVY_USER_INFO_URL, OTHER_KEY, clearHevyKey, renderHevyScreen, setInstantPacing, userInfoOk } from "../../test/hevyHarness";
import { server } from "../../test/msw/server";
import { HevyError } from "./client/hevyErrors";

/** A recognizable, valid-shaped key: any trace of it anywhere is a leak. */
const PLANTED_KEY = "5ec7e7a1-0b5e-4c3d-9a8f-1234deadbeef";

/** Every fetch the page made, serialized: URL, method, headers and body. */
let fetches: { url: string; text: string; hevy: boolean; apiKey: string | null }[] = [];

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  clearHevyKey();
  window.localStorage.clear();
  fetches = [];
  reported.calls = [];
  server.events.on("request:start", async ({ request }) => {
    const headers = JSON.stringify([...request.headers.entries()]);
    const body = request.method === "GET" ? "" : await request.clone().text();
    fetches.push({
      url: request.url,
      text: `${request.method} ${request.url} ${headers} ${body}`,
      hevy: new URL(request.url).hostname === "api.hevyapp.com",
      apiKey: request.headers.get("api-key"),
    });
  });
});
afterEach(() => {
  server.events.removeAllListeners();
  clearHevyKey();
  window.localStorage.clear();
  unstubAccountEnv();
});

async function paste(value: string) {
  const input = screen.getByLabelText("Hevy API key");
  await userEvent.clear(input);
  await userEvent.click(input);
  await userEvent.paste(value);
}
const save = () => userEvent.click(screen.getByRole("button", { name: "Save and remember" }));

/** Serializes everything a key could hide in. */
function leakSurface(queryClient: ReturnType<typeof renderHevyScreen>["queryClient"]): string {
  const cache = queryClient
    .getQueryCache()
    .getAll()
    .map((q) => JSON.stringify({ key: q.queryKey, data: q.state.data, error: q.state.error instanceof Error ? [q.state.error.message, q.state.error.name, q.state.error.stack] : q.state.error }));
  const reports = reported.calls.map(([err, ctx]) =>
    JSON.stringify({ message: (err as Error)?.message, name: (err as Error)?.name, stack: (err as Error)?.stack, ctx }),
  );
  return [...cache, ...reports, window.location.href].join("\n");
}

describe("20.0 AC7 — the key never leaves the device", () => {
  it("paste, verify, a failed Replace and Remove: the key goes only to Hevy, in the api-key header", async () => {
    server.use(userInfoOk());
    const { queryClient } = renderHevyScreen();
    await paste(PLANTED_KEY);
    await save();
    await screen.findByText(/••••beef/);
    // Checked at each step: a later Remove empties the cache, which would hide an earlier leak.
    expect(leakSurface(queryClient)).not.toContain(PLANTED_KEY);

    server.use(http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ error: "no" }, { status: 401 })));
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    await paste(OTHER_KEY);
    await save();
    await screen.findByText(/Hevy didn't accept that key/);
    expect(leakSurface(queryClient)).not.toContain(PLANTED_KEY);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await screen.findByLabelText("Hevy API key");

    const carrying = fetches.filter((f) => f.text.includes(PLANTED_KEY));
    expect(carrying.length).toBeGreaterThan(0);
    for (const f of carrying) {
      expect(f.hevy).toBe(true);
      expect(f.apiKey).toBe(PLANTED_KEY);
      expect(f.url).not.toContain(PLANTED_KEY);
    }
    for (const f of fetches.filter((x) => !x.hevy)) expect(f.text).not.toContain(PLANTED_KEY);
    expect(leakSurface(queryClient)).not.toContain(PLANTED_KEY);
  });

  it.each([
    ["a 401", () => http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ error: `bad key ${PLANTED_KEY}` }, { status: 401 }))],
    ["a 500", () => http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ error: `boom ${PLANTED_KEY}` }, { status: 500 }))],
    ["a schema failure", () => http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ data: { id: PLANTED_KEY } }))],
    ["a fetch rejection", () => http.get(HEVY_USER_INFO_URL, () => HttpResponse.error())],
    ["a body that is not JSON", () => http.get(HEVY_USER_INFO_URL, () => new HttpResponse(`<html>${PLANTED_KEY}</html>`, { status: 200 }))],
  ])("%s: no reported error, cached error or page text holds the key", async (_label, handler) => {
    server.use(handler());
    const { queryClient } = renderHevyScreen();
    await paste(PLANTED_KEY);
    await save();
    await screen.findByRole("alert");
    expect(leakSurface(queryClient)).not.toContain(PLANTED_KEY);
    expect(screen.getByLabelText("Hevy API key")).toHaveValue(PLANTED_KEY);
    const pageTextOutsideField = document.body.textContent ?? "";
    expect(pageTextOutsideField).not.toContain(PLANTED_KEY);
  });

  it("a HevyError that reaches the root error boundary shows nothing of the key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Thrower(): never {
      throw new HevyError("bad_key", { status: 401 });
    }
    const router = createMemoryRouter([{ path: "/", element: <Thrower />, errorElement: <RootErrorBoundary /> }]);
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading");
    expect(document.body.textContent).not.toContain(PLANTED_KEY);
    expect(leakSurfaceOf(reported.calls)).not.toContain(PLANTED_KEY);
  });
});

function leakSurfaceOf(calls: unknown[][]): string {
  return calls.map(([err, ctx]) => JSON.stringify({ message: (err as Error)?.message, stack: (err as Error)?.stack, ctx })).join("\n");
}
