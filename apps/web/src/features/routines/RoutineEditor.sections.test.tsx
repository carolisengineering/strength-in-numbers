import { screen, waitFor, within } from "@testing-library/react";
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

import { ROUTINE_SECTIONS_MAX } from "@sin/core";
import { SECTION_EMPTY_HINT, SECTION_STARTERS, SECTIONS_CAP_MESSAGE } from "./messages";
import { markupOf } from "../../test/markup";
import { routineId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { catalog, pushA, pushSectioned } from "../../test/routineFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

const EDIT_B = `/app/workouts/routines/${routineId(2)}/edit`;
const EDIT_A = `/app/workouts/routines/${routineId(1)}/edit`;

/** The page itself is a labelled `<section>` (the Screen shell); only the routine's own section regions count here. */
const sectionRegions = () => screen.queryAllByRole("region").filter((r) => !/^(Edit|New) routine$/.test(r.getAttribute("aria-label") ?? r.querySelector("h1")?.textContent ?? ""));

async function open(
  path: string,
  routines = [pushA, pushSectioned],
  ready: () => Promise<unknown> = () => screen.findByLabelText("Name"),
) {
  const fake = createWorkoutFake({ catalog, routines });
  prepareApp({ auth, catalog, fake });
  const app = renderApp(path);
  await ready();
  return { fake, ...app };
}

describe("10.3 AC14 — a section-free routine looks exactly as in 10.2", () => {
  it("the exercise list markup is unchanged (baseline recorded before Spec 10.3's edits)", async () => {
    await open(EDIT_A);
    expect(markupOf(screen.getByRole("list", { name: "Exercises" }))).toMatchSnapshot();
    expect(sectionRegions()).toEqual([]);
    expect(screen.queryByText(SECTION_EMPTY_HINT)).toBeNull();
  });
});

const region = (name: string) => screen.getByRole("region", { name });
const editSection = (name: string) => screen.getByRole("button", { name: `Edit section ${name}` });

describe("10.3 AC14 — layout", () => {
  it("loose exercises first without a heading, then each section as a region: name, full note, Options, its exercises; an empty section shows the hint", async () => {
    await open(EDIT_B);
    const loose = screen.getByRole("list", { name: "Exercises" });
    expect(within(loose).getAllByRole("listitem")).toHaveLength(1);
    expect(within(loose).getByText("Overhead Press")).toBeInTheDocument();

    const warm = region("Warm-up");
    expect(within(warm).getByText("5 min rower, then band pull-aparts")).toBeInTheDocument(); // the note, in full
    expect(within(warm).getByText(SECTION_EMPTY_HINT)).toBeInTheDocument();
    expect(within(warm).queryAllByRole("listitem")).toEqual([]);

    const main = region("Main");
    expect(within(main).getAllByRole("listitem")).toHaveLength(2);
    expect(within(main).getByRole("button", { name: "Options for section Main" })).toBeInTheDocument();
    // order on screen: loose list, then Warm-up, then Main
    const order = [loose, warm, main].map((el) => el.compareDocumentPosition(main));
    expect(order[0]! & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("below the list: Add section, then Add exercise; the routine's own note field is unchanged", async () => {
    await open(EDIT_B);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Add section")).toBeGreaterThan(-1);
    expect(buttons.indexOf("Add section")).toBeLessThan(buttons.indexOf("Add exercise"));
    expect(screen.getByLabelText("Notes")).toHaveValue("Keep the session under 75 minutes");
  });
});

describe("10.3 AC15 — Add section", () => {
  it("the five starters are a labeled group; tapping one adds that section at once and closes the sheet", async () => {
    const { user } = await open(EDIT_A);
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = await screen.findByRole("dialog", { name: "Add section" });
    const group = within(dialog).getByRole("group", { name: "Section names" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([...SECTION_STARTERS]);
    await user.click(within(group).getByRole("button", { name: "Accessory" }));
    expect(screen.queryByRole("dialog", { name: "Add section" })).toBeNull();
    expect(region("Accessory")).toBeInTheDocument();
    expect(within(region("Accessory")).getByText(SECTION_EMPTY_HINT)).toBeInTheDocument();
  });

  it("free text: Add trims the name; a blank name keeps the sheet open with the message", async () => {
    const { user } = await open(EDIT_A);
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = await screen.findByRole("dialog", { name: "Add section" });
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByText("Give the section a name")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Name"), "  Cardio  ");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(region("Cardio")).toBeInTheDocument();
  });

  it("starters stay available when a same-named section exists; duplicates are legal", async () => {
    const { user } = await open(EDIT_A);
    for (let i = 0; i < 2; i += 1) {
      await user.click(screen.getByRole("button", { name: "Add section" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Add section" })).getByRole("button", { name: "Main" }));
    }
    expect(screen.getAllByRole("region", { name: "Main" })).toHaveLength(2);
  });

  it(`at ${ROUTINE_SECTIONS_MAX} sections the button is disabled with the hint`, async () => {
    const { user } = await open(EDIT_A);
    for (let i = 0; i < ROUTINE_SECTIONS_MAX; i += 1) {
      await user.click(screen.getByRole("button", { name: "Add section" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Add section" })).getByRole("button", { name: "Warm-up" }));
    }
    const add = screen.getByRole("button", { name: "Add section" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(SECTIONS_CAP_MESSAGE);
    expect(screen.getByText(SECTIONS_CAP_MESSAGE)).toBeInTheDocument();
  });
});

describe("10.3 AC16 — the section sheet", () => {
  it("Done commits name and note; Close discards", async () => {
    const { user } = await open(EDIT_B);
    await user.click(editSection("Main"));
    let dialog = await screen.findByRole("dialog", { name: "Edit section" });
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Heavy");
    await user.type(within(dialog).getByLabelText("Note"), "Pause every rep");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(region("Main")).toBeInTheDocument(); // discarded

    await user.click(editSection("Main"));
    dialog = await screen.findByRole("dialog", { name: "Edit section" });
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Heavy");
    await user.type(within(dialog).getByLabelText("Note"), "Pause every rep");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(within(region("Heavy")).getByText("Pause every rep")).toBeInTheDocument();
  });

  it("an invalid field keeps the sheet open with the app's message beside it", async () => {
    const { user } = await open(EDIT_B);
    await user.click(editSection("Main"));
    const dialog = await screen.findByRole("dialog", { name: "Edit section" });
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(within(dialog).getByText("Give the section a name")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit section" })).toBeInTheDocument();
  });

  it("Done on an untouched sheet does not arm the leave guard", async () => {
    const { user, router } = await open(EDIT_B);
    await user.click(editSection("Warm-up"));
    await user.click(within(await screen.findByRole("dialog", { name: "Edit section" })).getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).toBeNull();
    await waitFor(() => expect(router.state.location.pathname).not.toBe(EDIT_B));
  });
});

describe("10.3 AC17 — section Options", () => {
  it("Move up / Move down are disabled (not hidden) at the edges, with the reason in text", async () => {
    const { user } = await open(EDIT_B);
    await user.click(screen.getByRole("button", { name: "Options for section Warm-up" }));
    const up = screen.getByRole("button", { name: "Move Warm-up up" });
    expect(up).toBeDisabled();
    expect(up).toHaveAccessibleDescription("This is the first section");
    expect(screen.getByRole("button", { name: "Move Warm-up down" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Options for section Main" }));
    expect(screen.getByRole("button", { name: "Move Main down" })).toBeDisabled();
  });

  it("Move down swaps the sections and their exercises travel with them", async () => {
    const { user } = await open(EDIT_B);
    await user.click(screen.getByRole("button", { name: "Options for section Warm-up" }));
    await user.click(screen.getByRole("button", { name: "Move Warm-up down" }));
    const names = sectionRegions().map((r) => within(r).getAllByRole("button")[0]!.textContent);
    expect(names).toEqual(["Main", "Warm-up"]);
    expect(within(region("Main")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("Delete section acts at once, keeps the exercises as loose ones (superset kept), and focus goes to Add section", async () => {
    const { user } = await open(EDIT_B);
    await user.click(screen.getByRole("button", { name: "Options for section Main" }));
    await user.click(screen.getByRole("button", { name: "Delete section Main" }));
    expect(screen.queryByRole("region", { name: "Main" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull(); // no confirmation (D4)
    const loose = screen.getByRole("list", { name: "Exercises" });
    expect(within(loose).getAllByRole("listitem")).toHaveLength(3);
    expect(within(loose).getByRole("button", { name: /^Bench Press, superset 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add section" })).toHaveFocus();
  });

  it("every section action arms the Discard-changes guard", async () => {
    const { user } = await open(EDIT_B);
    await user.click(screen.getByRole("button", { name: "Options for section Warm-up" }));
    await user.click(screen.getByRole("button", { name: "Delete section Warm-up" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
  });
});
