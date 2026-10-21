import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
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

import { http, HttpResponse } from "msw";

import { API_BASE_URL } from "../../../test/catalogHarness";
import { cardGroup, cardGroups, importCatalog, readHiraya, trackPaths } from "../../../test/importFixtures";
import { server } from "../../../test/msw/server";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../../test/workoutHarness";
import { IMPORT_EDIT_PATH, IMPORT_PATH } from "../paths";
import { CONTINUE, EXERCISE_GONE, GO_TO_FIRST, needAttention, newOption } from "./messages";

afterEach(() => cleanupApp());

async function openNames() {
  const fake = createWorkoutFake();
  prepareApp({ auth, fake, catalog: [...importCatalog] });
  const app = renderApp(IMPORT_PATH);
  const seen = trackPaths(app.router);
  await readHiraya(app.user);
  await waitFor(() => expect(cardGroups()).toHaveLength(8));
  return { ...app, fake, seen };
}

async function rename(user: UserEvent, written: string, name: string) {
  const card = await cardGroup(written);
  await user.clear(within(card).getByLabelText("Name"));
  if (name !== "") await user.type(within(card).getByLabelText("Name"), name);
  return card;
}

describe("10.4 AC28 — Continue", () => {
  it("enabled when every card is decided and valid; goes to the editor route with the hand-off", async () => {
    const { user, fake, seen } = await openNames();
    const button = await screen.findByRole("button", { name: CONTINUE });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(seen).toContain(IMPORT_EDIT_PATH);
    expect(fake.requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it.each([
    ["a blank New name", 1, async (user: UserEvent) => rename(user, "Hand Release Pushups", "")],
    ["two New cards with one name", 2, async (user: UserEvent) => {
      const first = await rename(user, "Front Raise", "Raise");
      await rename(user, "Reverse Fly", "Raise");
      return first;
    }],
    ["a New name already in the list", 1, async (user: UserEvent) => rename(user, "Hand Release Pushups", "overhead presses")],
  ] as const)("%s blocks it", async (_, n, setup) => {
    const { user } = await openNames();
    const firstInvalidCard = await setup(user);
    const button = screen.getByRole("button", { name: CONTINUE });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(new RegExp(needAttention(n)));
    await user.click(screen.getByRole("button", { name: GO_TO_FIRST }));
    expect(document.activeElement?.closest("[data-card]")).toBe(firstInvalidCard);
  });

  it("a sync that drops a card's exercise: New is offered, Continue blocked, Go to the first one lands in the card", async () => {
    const powerClean = importCatalog.find((e) => e.name === "Power Clean")!;
    prepareApp({ auth, fake: createWorkoutFake(), catalog: [...importCatalog] });
    const held = deferred<void>();
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises`, async () => {
        await held.promise;
        return HttpResponse.json({ exercises: [{ ...powerClean, isActive: false }], syncToken: "1.300" });
      }),
    );
    const { user } = renderApp(IMPORT_PATH);
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8)); // built from the cached rows
    held.resolve();
    const card = await cardGroup("Power Clean");
    await within(card).findByText(EXERCISE_GONE);
    expect(within(card).getByRole("radio", { name: newOption("Power Clean") })).not.toBeChecked();
    expect(screen.getByRole("button", { name: CONTINUE })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: GO_TO_FIRST }));
    expect(document.activeElement?.closest("[data-card]")).toBe(card);
  });

  it("needAttention counts", () => expect([needAttention(1), needAttention(2)]).toEqual(["1 card needs attention", "2 cards need attention"]));
});
