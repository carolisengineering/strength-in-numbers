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
import { HIRAYA_TEXT, cardGroup, cardGroups, importCatalog, readHiraya } from "../../../test/importFixtures";
import { server } from "../../../test/msw/server";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { IMPORT_PATH } from "../paths";
import {
  BACK_TO_TEXT,
  CHANGE,
  CHOOSE_ANOTHER,
  IN_YOUR_LIST,
  NEW_NAME_REQUIRED,
  READ_BUTTON,
  SAME_NEW,
  TEXT_LABEL,
  TYPE_LABEL,
  USE_IT_INSTEAD,
  alreadyInList,
  newOption,
} from "./messages";

afterEach(() => cleanupApp());

async function openNames() {
  const fake = createWorkoutFake();
  prepareApp({ auth, fake, catalog: [...importCatalog] });
  const app = renderApp(IMPORT_PATH);
  await readHiraya(app.user);
  await waitFor(() => expect(cardGroups()).toHaveLength(8));
  return { ...app, fake };
}

describe("10.4 AC25 — Choose another exercise", () => {
  it("the picker has no create row; a pick becomes a third, selected option with Change; focus returns to it", async () => {
    const { user, fake } = await openNames();
    const card = await cardGroup("Front Raise");
    await user.click(within(card).getByRole("button", { name: `${CHOOSE_ANOTHER} for Front Raise` }));
    const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
    expect(within(dialog).queryByRole("button", { name: /Create a custom exercise/ })).toBeNull();
    await user.click(within(within(dialog).getByRole("region", { name: "All exercises" })).getByRole("button", { name: /Barbell row/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const picked = within(card).getByRole("radio", { name: "Barbell row" });
    expect(picked).toBeChecked();
    expect(picked).toHaveFocus();
    expect(within(card).getByRole("button", { name: `${CHANGE}: Barbell row` })).toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "POST")).toEqual([]);
  });
});

describe("10.4 AC26 — the New card reuses the create fields", () => {
  it("Name as written, Type guessed, More details closed; two open cards keep separate controls", async () => {
    const { user } = await openNames();
    const hand = await cardGroup("Hand Release Pushups");
    expect(within(hand).getByLabelText("Name")).toHaveValue("Hand Release Pushups");
    expect(within(hand).getByRole("group", { name: TYPE_LABEL })).toBeInTheDocument();
    expect(within(hand).getByRole("radio", { name: "Bodyweight × reps" })).toBeChecked();
    expect(within(hand).getByText("More details").closest("details")).not.toHaveAttribute("open");
    const front = await cardGroup("Front Raise");
    await user.click(within(front).getByRole("radio", { name: "Duration" }));
    expect(within(front).getByRole("radio", { name: "Duration" })).toBeChecked();
    expect(within(hand).getByRole("radio", { name: "Bodyweight × reps" })).toBeChecked();
    expect(within(front).getByLabelText("Name").id).not.toBe(within(hand).getByLabelText("Name").id);
  });

  it("a match selected hides the fields", async () => {
    await openNames();
    const strict = await cardGroup("Strict Press");
    expect(within(strict).queryByLabelText("Name")).toBeNull();
  });

  it("reference data not loaded → no More details", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake, catalog: [...importCatalog] });
    server.use(http.get(`${API_BASE_URL}/v1/muscle-groups`, () => HttpResponse.error()));
    const { user } = renderApp(IMPORT_PATH);
    await readHiraya(user);
    const hand = await cardGroup("Hand Release Pushups");
    expect(within(hand).getByLabelText("Name")).toBeInTheDocument();
    expect(within(hand).queryByText("More details")).toBeNull();
  });
});

describe("10.4 AC27 — names that already exist, on screen", () => {
  it("Use it instead selects the exercise and returns focus to the card", async () => {
    const { user } = await openNames();
    const hand = await cardGroup("Hand Release Pushups");
    await user.clear(within(hand).getByLabelText("Name"));
    await user.type(within(hand).getByLabelText("Name"), "overhead presses");
    expect(within(hand).getByText(alreadyInList("Overhead press"))).toBeInTheDocument();
    await user.click(within(hand).getByRole("button", { name: `${USE_IT_INSTEAD}: Overhead press` }));
    const chosen = within(hand).getByRole("radio", { name: /Overhead press/ });
    expect(chosen).toBeChecked();
    expect(chosen).toHaveFocus();
    expect(within(hand).getByText(IN_YOUR_LIST)).toBeInTheDocument();
    // A tap can be undone: New stays on the card, with the typed name.
    await user.click(within(hand).getByRole("radio", { name: newOption("overhead presses") }));
    expect(within(hand).getByLabelText("Name")).toHaveValue("overhead presses");
  });

  it("the blocking notices are announced", async () => {
    const { user } = await openNames();
    const hand = await cardGroup("Hand Release Pushups");
    await user.clear(within(hand).getByLabelText("Name"));
    await user.type(within(hand).getByLabelText("Name"), "Overhead press");
    expect(within(hand).getByRole("status")).toHaveTextContent(alreadyInList("Overhead press"));
    for (const written of ["Front Raise", "Reverse Fly"]) {
      const card = await cardGroup(written);
      await user.clear(within(card).getByLabelText("Name"));
      await user.type(within(card).getByLabelText("Name"), "Raise");
    }
    expect(within(await cardGroup("Front Raise")).getByRole("status")).toHaveTextContent(SAME_NEW);
  });

  it("two New cards with one name both say so, with no button", async () => {
    const { user } = await openNames();
    for (const written of ["Front Raise", "Reverse Fly"]) {
      const card = await cardGroup(written);
      await user.clear(within(card).getByLabelText("Name"));
      await user.type(within(card).getByLabelText("Name"), "Raise");
    }
    expect(screen.getAllByText(SAME_NEW)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: new RegExp(USE_IT_INSTEAD) })).toBeNull();
  });

  it("the field's own messages", async () => {
    const { user } = await openNames();
    const hand = await cardGroup("Hand Release Pushups");
    await user.clear(within(hand).getByLabelText("Name"));
    expect(within(hand).getByRole("alert")).toHaveTextContent(NEW_NAME_REQUIRED);
    expect(within(hand).getByRole("radio", { name: newOption("Hand Release Pushups") })).toBeChecked();
  });
});

describe("10.4 AC21 — the session keeps choices for the same text", () => {
  it("a different text re-read resets the cards; the same text keeps them", async () => {
    const { user } = await openNames();
    await user.click(within(await cardGroup("Strict Press")).getByRole("radio", { name: newOption("Strict Press") }));
    await user.click(screen.getByRole("link", { name: BACK_TO_TEXT }));
    await user.click(await screen.findByRole("button", { name: READ_BUTTON }));
    expect(within(await cardGroup("Strict Press")).getByRole("radio", { name: newOption("Strict Press") })).toBeChecked();
    await user.click(screen.getByRole("link", { name: BACK_TO_TEXT }));
    await user.click(await screen.findByLabelText(TEXT_LABEL));
    await user.clear(screen.getByLabelText(TEXT_LABEL));
    await user.paste(HIRAYA_TEXT + "\nOne more line.");
    await user.click(screen.getByRole("button", { name: READ_BUTTON }));
    expect(within(await cardGroup("Strict Press")).getByRole("radio", { name: /Overhead press/ })).toBeChecked();
  });
});
