import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { screen, waitFor, within } from "@testing-library/react";
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

import { cardGroup, cardGroups, importCatalog, readHiraya, toEditor } from "../../../test/importFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { makeRoutine, routineId } from "../../../test/workoutFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { LIMIT_MESSAGE } from "../messages";
import { IMPORT_PATH } from "../paths";
import { IMPORTED_NOTICE, importNoticeText } from "./messages";
import { CHOOSE_ANOTHER, CONTINUE, HOW_TO_INTRO, NAMES_TITLE, NEW_NAME_REQUIRED, READ_BUTTON, TEXT_LABEL, USE_IT_INSTEAD, needAttention } from "./messages";

afterEach(() => cleanupApp());

async function openNames() {
  prepareApp({ auth, fake: createWorkoutFake(), catalog: [...importCatalog] });
  const app = renderApp(IMPORT_PATH);
  await readHiraya(app.user);
  await waitFor(() => expect(cardGroups()).toHaveLength(8));
  return app;
}

describe("10.4 AC37 — accessibility (Phase B screens)", () => {
  it("paste screen: visible label, ordered how-to, disabled Read with its reason in text", async () => {
    const routines = Array.from({ length: ROUTINES_PER_USER_MAX }, (_, i) => makeRoutine({ id: routineId(i + 1), name: `R${i}` }));
    prepareApp({ auth, fake: createWorkoutFake({ routines }) });
    renderApp(IMPORT_PATH);
    const box = await screen.findByLabelText(TEXT_LABEL);
    expect(document.querySelector(`label[for="${box.id}"]`)?.textContent).toBe(TEXT_LABEL);
    expect(screen.getByRole("list", { name: HOW_TO_INTRO }).tagName).toBe("OL");
    await screen.findByText(LIMIT_MESSAGE);
    expect(screen.getByRole("button", { name: READ_BUTTON })).toBeDisabled();
    expect(screen.getByRole("button", { name: READ_BUTTON })).toHaveAccessibleDescription(LIMIT_MESSAGE);
  });

  it("cards: fieldset named by the written name, text tags, control names name their target, errors are alerts", async () => {
    const { user } = await openNames();
    const front = await cardGroup("Front Raise");
    expect(front.tagName).toBe("FIELDSET");
    expect(within(front).getByRole("button", { name: `${CHOOSE_ANOTHER} for Front Raise` })).toBeInTheDocument();
    const hand = await cardGroup("Hand Release Pushups");
    await user.clear(within(hand).getByLabelText("Name"));
    expect(within(hand).getByRole("alert")).toHaveTextContent(NEW_NAME_REQUIRED);
    await user.type(within(hand).getByLabelText("Name"), "Overhead press");
    expect(within(hand).getByRole("button", { name: `${USE_IT_INSTEAD}: Overhead press` })).toBeInTheDocument();
  });

  it("the Check heading takes focus on arrival; Continue disabled is `disabled` with its reason", async () => {
    const { user } = await openNames();
    expect(screen.getByRole("heading", { level: 1, name: NAMES_TITLE })).toHaveFocus();
    await user.clear(within(await cardGroup("Hand Release Pushups")).getByLabelText("Name"));
    const button = screen.getByRole("button", { name: CONTINUE });
    expect(button).toHaveAttribute("disabled");
    expect(button).toHaveAccessibleDescription(needAttention(1));
  });
});

describe("10.4 AC37 — accessibility (editor side)", () => {
  it("the editor's first notice is a polite status; New is text; warnings are alerts", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ catalog: [...importCatalog] }), catalog: [...importCatalog] });
    const { user } = renderApp(IMPORT_PATH);
    await toEditor(user, `Workout: "${"N".repeat(81)}"\n3 Sets:\n10 Hand Release Pushups\nx.`);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(IMPORTED_NOTICE);
    expect(within(screen.getByRole("button", { name: /^Hand Release Pushups \(New\)/ })).getByText("New")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(importNoticeText({ code: "name-cut" }));
  });
});
