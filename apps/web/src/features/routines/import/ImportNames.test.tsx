import { screen, waitFor, within } from "@testing-library/react";
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

import { API_BASE_URL } from "../../../test/catalogHarness";
import { cardGroups, importCatalog, readHiraya } from "../../../test/importFixtures";
import { server } from "../../../test/msw/server";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../../test/workoutHarness";
import { IMPORT_PATH } from "../paths";
import { CATALOG_FAILED, CATALOG_LOADING, IN_YOUR_LIST, NAMES_TITLE, NOTHING_SIMILAR, SIMILAR, newOption, usedIn } from "./messages";

const EXERCISES_URL = `${API_BASE_URL}/v1/exercises`;
const syncBody = (rows: readonly unknown[]) => ({ exercises: rows, syncToken: "1.200" });

afterEach(() => cleanupApp());

describe("10.4 AC23 — names are classified only against a synced catalog", () => {
  it("never synced and no rows: loading, then cards", async () => {
    prepareApp({ auth, fake: createWorkoutFake(), catalog: [] });
    const held = deferred<void>();
    server.use(http.get(EXERCISES_URL, async () => {
      await held.promise;
      return HttpResponse.json(syncBody(importCatalog));
    }));
    const { user } = renderApp(IMPORT_PATH);
    await readHiraya(user);
    expect(await screen.findByText(CATALOG_LOADING)).toBeInTheDocument();
    expect(cardGroups()).toEqual([]);
    held.resolve();
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    expect(within(cardGroups()[1]!).getByText(IN_YOUR_LIST)).toBeInTheDocument();
  });

  it("a failed first sync: the error, Retry, no cards, no Continue", async () => {
    prepareApp({ auth, fake: createWorkoutFake(), catalog: [] });
    server.use(http.get(EXERCISES_URL, () => HttpResponse.error()));
    const { user } = renderApp(IMPORT_PATH);
    await readHiraya(user);
    expect(await screen.findByText(CATALOG_FAILED)).toBeInTheDocument();
    expect(cardGroups()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    server.use(http.get(EXERCISES_URL, () => HttpResponse.json(syncBody(importCatalog))));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
  });

  it("cached rows with a stale sync proceed at once", async () => {
    prepareApp({ auth, fake: createWorkoutFake(), catalog: [...importCatalog] });
    const held = deferred<void>();
    server.use(http.get(EXERCISES_URL, async () => {
      await held.promise;
      return HttpResponse.json(syncBody(importCatalog));
    }));
    const { user } = renderApp(IMPORT_PATH);
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    expect(screen.queryByText(CATALOG_LOADING)).toBeNull();
    held.resolve();
  });
});

describe("10.4 AC24 — the Check screen", () => {
  it("summary, card order, usage line, text tags, radios named by the written name", async () => {
    prepareApp({ auth, fake: createWorkoutFake(), catalog: [...importCatalog] });
    const { user } = renderApp(IMPORT_PATH);
    await readHiraya(user);
    expect(await screen.findByRole("heading", { level: 1, name: NAMES_TITLE })).toHaveFocus();
    expect(screen.getByText("Found 4 sections and 8 exercises from 5 screenshots")).toBeInTheDocument();
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    const groups = cardGroups();
    expect(groups.map((g) => g.querySelector("legend")?.textContent)).toEqual([
      "Strict Press", "Power Clean", "Hand Release Pushups", "Push Press", "400 Meter Run", "Front Raise", "Reverse Fly", "DB Lateral Lunge",
    ]);
    const strict = within(groups[0]!);
    expect(strict.getByRole("radio", { name: /Overhead press/ })).toBeChecked();
    expect(strict.getByText(SIMILAR)).toBeInTheDocument();
    expect(strict.getByRole("radio", { name: newOption("Strict Press") })).not.toBeChecked();
    expect(within(groups[1]!).getByText(IN_YOUR_LIST)).toBeInTheDocument();
    expect(within(groups[1]!).queryByRole("radio", { name: /^New:/ })).toBeNull();
    expect(within(groups[2]!).getByText(NOTHING_SIMILAR)).toBeInTheDocument();
    expect(within(groups[2]!).getByRole("radio", { name: newOption("Hand Release Pushups") })).toBeChecked();
    expect(screen.getByText(usedIn(["Second Shift"]), { selector: `[data-card="1"] *` })).toBeInTheDocument();
    const names = new Set(groups.map((g) => within(g).getAllByRole("radio")[0]!.getAttribute("name")));
    expect(names.size).toBe(8);
  });

  it("a choice is kept: picking New on a similar card checks it", async () => {
    prepareApp({ auth, fake: createWorkoutFake(), catalog: [...importCatalog] });
    const { user } = renderApp(IMPORT_PATH);
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    await user.click(within(cardGroups()[0]!).getByRole("radio", { name: newOption("Strict Press") }));
    expect(within(cardGroups()[0]!).getByRole("radio", { name: newOption("Strict Press") })).toBeChecked();
  });

  it("an empty session redirects to the paste screen", async () => {
    prepareApp({ auth, fake: createWorkoutFake() });
    const { router } = renderApp(`${IMPORT_PATH}/names`);
    await screen.findByLabelText("Workout text");
    expect(router.state.location.pathname).toBe(IMPORT_PATH);
  });
});
