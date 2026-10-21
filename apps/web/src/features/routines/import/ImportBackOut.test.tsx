import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
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

import { cardGroups, importCatalog, readHiraya, toEditor } from "../../../test/importFixtures";
import { createWorkoutFake, type WorkoutFake } from "../../../test/workoutFake";
import { makeRoutine, routineId } from "../../../test/workoutFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { LIMIT_MESSAGE } from "../messages";
import { IMPORT_EDIT_PATH, IMPORT_NAMES_PATH, IMPORT_PATH } from "../paths";
import { ROUTINE_KEYS } from "../queries";
import { PASTE_TITLE, TEXT_LABEL } from "./messages";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

const writesOf = (fake: WorkoutFake) => fake.requests.filter((r) => r.method !== "GET");

function start(routines = 0) {
  const fake = createWorkoutFake({
    catalog: [...importCatalog],
    serveExercises: true,
    routines: Array.from({ length: routines }, (_, i) => makeRoutine({ id: routineId(i + 1), name: `R${i}` })),
  });
  prepareApp({ auth, fake, catalog: [...importCatalog] });
  return { fake, ...renderApp(IMPORT_PATH) };
}

type App = ReturnType<typeof start>;
const SCREENS: Record<string, { path: string; reach: (app: App) => Promise<void> }> = {
  paste: { path: IMPORT_PATH, reach: async ({ user }) => {
    await user.click(await screen.findByLabelText(TEXT_LABEL));
    await user.paste("Strength\n3 Sets:\n10 Curl\nx.");
  } },
  names: { path: IMPORT_NAMES_PATH, reach: async ({ user }) => {
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
  } },
  editor: { path: IMPORT_EDIT_PATH, reach: async ({ user }) => toEditor(user) },
};

async function discardIfAsked(user: App["user"]) {
  const discard = await screen.findByRole("button", { name: "Discard" }).catch(() => null);
  if (discard) await user.click(discard);
}

describe("10.4 AC33 — backing out leaves nothing", () => {
  it.each(Object.keys(SCREENS))("from the %s screen (Back, nav tab, reload)", async (where) => {
    const { path, reach } = SCREENS[where]!;
    // Back
    let app = start();
    await reach(app);
    await act(() => app.router.navigate(-1));
    if (where === "editor") await discardIfAsked(app.user);
    expect(writesOf(app.fake)).toEqual([]);
    cleanup();
    cleanupApp();
    // A nav tab
    app = start();
    await reach(app);
    await app.user.click(screen.getByRole("link", { name: "History" }));
    if (where === "editor") await discardIfAsked(app.user);
    await screen.findByRole("heading", { level: 1, name: "History" });
    expect(writesOf(app.fake)).toEqual([]);
    cleanup();
    cleanupApp();
    // A reload: the same URL in a fresh app has no session and lands on an empty paste screen
    app = start();
    await reach(app);
    const fake = app.fake;
    cleanup();
    prepareApp({ auth, fake, catalog: [...importCatalog] });
    renderApp(path);
    expect(await screen.findByLabelText(TEXT_LABEL)).toHaveValue("");
    expect(writesOf(fake)).toEqual([]);
  });

  it("removing every item of a pending exercise means it is never created", async () => {
    const { user, fake } = start();
    await toEditor(user);
    const row = [...document.querySelectorAll<HTMLElement>("li[data-name]")].find((li) => li.dataset.name === "Reverse Fly")!;
    await user.click(within(row).getByRole("button", { name: "Options" }));
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    const created = fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/exercises").map((r) => (r.body as { name: string }).name);
    expect(created).toEqual(["Hand Release Pushups", "Front Raise"]);
  });
});

describe("10.4 AC32 — the routine limit at Save creates nothing", () => {
  it("50 routines by Save time: LIMIT_MESSAGE, no POST at all", async () => {
    const { user, fake, queryClient } = start(ROUTINES_PER_USER_MAX - 1);
    await toEditor(user);
    const extra = makeRoutine({ id: routineId(ROUTINES_PER_USER_MAX), name: "From another device" });
    fake.state.routines.set(extra.id, extra);
    await act(() => queryClient.refetchQueries({ queryKey: ROUTINE_KEYS.list }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(LIMIT_MESSAGE)).toBeInTheDocument();
    expect(writesOf(fake)).toEqual([]);
  });
});

describe("10.4 AC20 — after Save the session is gone", () => {
  it("Back from the preview lands on an empty paste screen and sends nothing", async () => {
    const { user, fake, router } = start();
    await toEditor(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    const sent = writesOf(fake).length;
    await act(() => router.navigate(-1));
    expect(await screen.findByRole("heading", { level: 1, name: PASTE_TITLE })).toBeInTheDocument();
    expect(screen.getByLabelText(TEXT_LABEL)).toHaveValue("");
    expect(writesOf(fake)).toHaveLength(sent);
  });
});
