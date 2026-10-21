import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { screen, waitFor } from "@testing-library/react";
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

import { cardGroups, importCatalog, readHiraya } from "../../../test/importFixtures";
import { filesUnder } from "../../../test/sourceScan";
import { createWorkoutFake } from "../../../test/workoutFake";
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
  it("no markup injection, inline style or storage names", () => {
    const sources = importSources();
    expect(sources.length).toBeGreaterThanOrEqual(7);
    for (const [file, src] of sources) {
      expect(src, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML|\bstyle\s*=|<style/);
      expect(src, file).not.toMatch(/localStorage|sessionStorage/);
    }
  });
});
