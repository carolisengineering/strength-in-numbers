import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { API_BASE_URL } from "../../../test/catalogHarness";
import { cardGroups, importCatalog, readHiraya, toEditor } from "../../../test/importFixtures";
import { server } from "../../../test/msw/server";
import { USER_DATA_KEY_PREFIXES } from "../../../storage/clearUserData";
import { filesUnder } from "../../../test/sourceScan";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { IMPORT_PATH } from "../paths";
import { CONTINUE } from "./messages";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBES = ["Second Shift", "Hand Release Pushups", "Heaviest successful set"];

afterEach(() => {
  cleanupApp();
  vi.restoreAllMocks();
});

/** The import screens' non-test sources (a test file may name what it scans for). */
function importSources(): Array<[string, string]> {
  return filesUnder(HERE, /\.(ts|tsx)$/)
    .filter((path) => !/\.test\.tsx?$/.test(path))
    .map((path) => [path, readFileSync(path, "utf8")]);
}

describe("10.4 AC20 — nothing persists, nothing in a URL or router state", () => {
  it("storage, URLs, history state and telemetry never carry the pasted text", async () => {
    prepareApp({ auth, fake: createWorkoutFake(), catalog: [...importCatalog] });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { router, user } = renderApp(IMPORT_PATH);
    const locations: unknown[] = [];
    router.subscribe((s) => locations.push(s.location));
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    await user.click(await screen.findByRole("button", { name: CONTINUE }));
    const seen = JSON.stringify([setItem.mock.calls, locations, observability.track.mock.calls, observability.reportError.mock.calls]);
    for (const probe of PROBES) expect(seen).not.toContain(probe);
  });
});

describe("10.4 AC35 — import sources render text as text (Phase B files)", () => {
  it("no markup injection, inline style, storage names or console output", () => {
    const sources = importSources();
    expect(sources.length).toBeGreaterThanOrEqual(7);
    for (const [file, src] of sources) {
      expect(src, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML|\bstyle\s*=|<style/);
      expect(src, file).not.toMatch(/localStorage|sessionStorage/);
      expect(src, file).not.toMatch(/\bconsole\./);
    }
  });
});

describe("10.4 AC35 — the text stays text and stays here", () => {
  const SECRET = "Zanzibar Quokka Lift";
  const TEXT = `Engine\nA note about the ${SECRET} here.\n21-15-9\n${SECRET}\nRow\nx.`;
  const expand = (_: string, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message, cause: String(v.cause) } : v);

  it("spies see no pasted text on any path, failures included", async () => {
    const fake = createWorkoutFake({ catalog: [...importCatalog], serveExercises: true });
    prepareApp({ auth, fake, catalog: [...importCatalog] });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const consoleCalls = (["error", "warn", "log", "info"] as const).map((level) => vi.spyOn(console, level));
    const { router, user } = renderApp(IMPORT_PATH);
    const locations: unknown[] = [];
    router.subscribe((s) => locations.push(s.location));
    await toEditor(user, TEXT);
    const beforeSave = setItem.mock.calls.length;
    const save = () => screen.getByRole("button", { name: "Save" });
    // 1: the create fails at the server
    fake.failNext({ method: "POST", path: /^\/v1\/exercises$/ }, () => problemResponse(500, "about:blank"));
    await user.click(save());
    await waitFor(() => expect(save()).toBeEnabled());
    // 2: the create answers with a body the client cannot read (a non-ApiError path)
    server.use(http.post(`${API_BASE_URL}/v1/exercises`, () => HttpResponse.json({ unexpected: true }, { status: 201 }), { once: true }));
    await user.click(save());
    await waitFor(() => expect(save()).toBeEnabled());
    // 3: success
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Engine" });
    // Before Save nothing is stored. After a create, the exercise is the owner's like any custom exercise: the
    // catalog cache (and recents) hold it under the existing user-data keys that logout clears.
    const storedBeforeSave = setItem.mock.calls.slice(0, beforeSave);
    const storedLater = setItem.mock.calls.slice(beforeSave).filter(([key]) => !/^sin:(catalog|recents):/.test(String(key)));
    const seen = JSON.stringify(
      [observability.track.mock.calls, observability.reportError.mock.calls, consoleCalls.map((c) => c.mock.calls), storedBeforeSave, storedLater, locations],
      expand,
    );
    expect(seen).not.toContain("Zanzibar");
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "routine-import", op: "create-exercise" });
  });

  it("markup in a note renders as text", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ catalog: [...importCatalog] }), catalog: [...importCatalog] });
    const { user } = renderApp(IMPORT_PATH);
    await toEditor(user, "Strength\n<img src=x onerror=alert(1)>\n3 Sets:\n10 Curl\nx.");
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.innerHTML).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("USER_DATA_KEY_PREFIXES is unchanged", () => expect(USER_DATA_KEY_PREFIXES).toEqual(["sin:catalog:", "sin:recents:", "sin:workout:"]));
});
