import { cleanup, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
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
const caches = vi.hoisted(() => ({ imported: vi.fn() }));
vi.mock("../../records/cache", async (original) => {
  const actual = await original<typeof import("../../records/cache")>();
  return {
    ...actual,
    applyImportedCaches: (...args: Parameters<typeof actual.applyImportedCaches>) => {
      caches.imported(...args);
      actual.applyImportedCaches(...args);
    },
  };
});

import { API_BASE_URL } from "../../../test/accountHarness";
import { setInstantPacing, userInfoOk, USER_ID, VALID_KEY } from "../../../test/hevyHarness";
import { fakeImportApi } from "../../../test/hevyImportFakes";
import { server } from "../../../test/msw/server";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { hevyKeyStore } from "../keyStore";
import { HEVY_PATH } from "../paths";
import { resetImportLaneForTests } from "./importLane";

function setup(options: Parameters<typeof fakeImportApi>[0] = {}) {
  prepareApp({ auth, fake: createWorkoutFake() });
  const imports = fakeImportApi(options);
  server.use(userInfoOk(), http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json({ pairs: [], sectionRules: [] })), ...imports.handlers);
  hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  return imports;
}

beforeEach(() => {
  setInstantPacing();
  caches.imported.mockReset();
});
afterEach(() => {
  cleanup();
  hevyKeyStore.remove(USER_ID);
  resetImportLaneForTests();
  cleanupApp();
});

const finishes = (imports: ReturnType<typeof fakeImportApi>) => imports.log.filter((r) => r.path === "/v1/hevy/import/finish");

describe("20.1 AC22 — the Hevy screen's stale-records banner", () => {
  it("shows while the records are stale; Finish the last step sends one finish with no body and refreshes the caches", async () => {
    const imports = setup({ recordsStale: true });
    const { user } = renderApp(HEVY_PATH);
    await user.click(await screen.findByRole("button", { name: "Finish the last step" }));
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish the last step" })).toBeNull();
    expect(finishes(imports)).toEqual([{ path: "/v1/hevy/import/finish", method: "POST", contentType: null, body: undefined }]);
    expect(caches.imported).toHaveBeenCalledTimes(1);
  });

  it("is absent when the records are not stale", async () => {
    setup({ recordsStale: false });
    renderApp(HEVY_PATH);
    expect(await screen.findByRole("heading", { name: "Import from Hevy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish the last step" })).toBeNull();
  });

  it("a failed finish says so and stays; Try again succeeds and the banner goes", async () => {
    const imports = setup({ recordsStale: true });
    imports.failSequence([500]);
    const { user } = renderApp(HEVY_PATH);
    await user.click(await screen.findByRole("button", { name: "Finish the last step" }));
    expect(await screen.findByText("Your workouts are in, but updating your records didn't finish.")).toBeInTheDocument();
    expect(caches.imported).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(finishes(imports)).toHaveLength(2);
    expect(caches.imported).toHaveBeenCalledTimes(1);
  });

  it("a finish answering recomputed: false still reads Records updated (Review Focus 5)", async () => {
    const imports = setup({ recordsStale: true });
    // Another tab finished first: the server holds nothing stale, but this tab's status still says stale.
    server.use(http.post(`${API_BASE_URL}/v1/hevy/import/finish`, () => HttpResponse.json({ recomputed: false, rootCount: 0 })));
    const { user } = renderApp(HEVY_PATH);
    const button = await screen.findByRole("button", { name: "Finish the last step" });
    imports.state.recordsStale = false;
    await user.click(button);
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Finish the last step" })).toBeNull());
  });
});
