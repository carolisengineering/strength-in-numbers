import { waitFor, within } from "@testing-library/react";
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
// A spy that still counts, so the summary reads as usual.
vi.mock("./cards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cards")>();
  return { ...actual, keptSectionCount: vi.fn(actual.keptSectionCount), cardNames: vi.fn(actual.cardNames) };
});

import { cardGroup, cardGroups, importCatalog, readHiraya } from "../../../test/importFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { IMPORT_PATH } from "../paths";
import { cardNames, keptSectionCount } from "./cards";

afterEach(() => cleanupApp());

describe("Minor 59 — the section count is not rebuilt on a keystroke", () => {
  it("typing three characters into a New card's name builds it at most once more", async () => {
    prepareApp({ auth, fake: createWorkoutFake(), catalog: [...importCatalog] });
    const { user } = renderApp(IMPORT_PATH);
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    const name = within(await cardGroup("Hand Release Pushups")).getByLabelText("Name");
    vi.mocked(keptSectionCount).mockClear();
    await user.type(name, "abc");
    expect(vi.mocked(keptSectionCount).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("code review — the card names (which build the plan too) are not rebuilt on a keystroke either", async () => {
    prepareApp({ auth, fake: createWorkoutFake(), catalog: [...importCatalog] });
    const { user } = renderApp(IMPORT_PATH);
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    const name = within(await cardGroup("Hand Release Pushups")).getByLabelText("Name");
    vi.mocked(cardNames).mockClear();
    await user.type(name, "abc");
    expect(vi.mocked(cardNames).mock.calls.length).toBeLessThanOrEqual(1);
  });
});
