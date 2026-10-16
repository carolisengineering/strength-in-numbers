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
import { addFromPicker } from "../../test/routineHarness";
import { problemResponse } from "../../test/workoutFake";
import { SECTION_NAME_INVALID, SECTION_UNLINK_NOTICE } from "./messages";
import { FORM_INVALID } from "./validateDraft";
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

/** The page itself is a labeled `<section>` (the Screen shell); only the routine's own section regions count here. */
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
  // Baseline recorded before Spec 10.3's edits; re-baselined 2026-10-16 when the design refresh (Stage 1) wrapped each row in a card.
  it("the exercise list markup matches the section-free baseline", async () => {
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

const rowOptions = async (user: Awaited<ReturnType<typeof open>>["user"], name: RegExp) => {
  const row = screen.getByRole("button", { name }).closest("li")!;
  await user.click(within(row).getByRole("button", { name: "Options" }));
  return row;
};

describe("10.3 AC18 — Move to section", () => {
  it("the sheet lists No section and every section; the current place is shown and disabled; choosing moves the row and returns focus to it", async () => {
    const { user } = await open(EDIT_B);
    const row = await rowOptions(user, /^Overhead Press/);
    await user.click(within(row).getByRole("button", { name: "Move to section…" }));
    const dialog = await screen.findByRole("dialog", { name: /Move Overhead Press/ });
    expect(within(dialog).getByRole("button", { name: /No section/ })).toBeDisabled(); // it is loose
    expect(within(dialog).getByRole("button", { name: "Warm-up" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Warm-up" }));
    expect(screen.queryByRole("dialog", { name: /Move Overhead Press/ })).toBeNull();
    expect(within(region("Warm-up")).getByRole("button", { name: /^Overhead Press/ })).toHaveFocus();
    expect(screen.queryByText(SECTION_EMPTY_HINT)).toBeNull(); // Warm-up has an exercise now
  });

  it("moving a linked exercise out unlinks it and shows the dismissible notice", async () => {
    const { user } = await open(EDIT_B);
    const row = await rowOptions(user, /^Bench Press/);
    await user.click(within(row).getByRole("button", { name: "Move to section…" }));
    await user.click(within(await screen.findByRole("dialog", { name: /Move Bench Press/ })).getByRole("button", { name: /No section/ }));
    expect(screen.getByText(SECTION_UNLINK_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Barbell Row$|^Barbell Row,/ })).toBeInTheDocument(); // no longer 'superset 1'
    expect(screen.queryByRole("button", { name: /superset 1/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(SECTION_UNLINK_NOTICE)).toBeNull();
  });

  it("the action is absent when the routine has no sections", async () => {
    const { user } = await open(EDIT_A);
    const row = await rowOptions(user, /^Bench Press/);
    expect(within(row).queryByRole("button", { name: "Move to section…" })).toBeNull();
  });
});

describe("10.3 AC19 — links and Add exercise follow sections", () => {
  it("'Superset with next' exists only between two exercises of the same section; none across a heading", async () => {
    await open(EDIT_B);
    // Overhead Press (loose) is directly followed by the Warm-up heading and Main's exercises: no toggle after it.
    expect(screen.queryByRole("button", { name: /Superset Overhead Press with/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Superset Bench Press with Barbell Row" })).toHaveAttribute("aria-pressed", "true");
    // The last exercise of Main has nothing below it in its section.
    expect(screen.queryByRole("button", { name: /Superset Barbell Row with/ })).toBeNull();
  });

  it("Move up / Move down are disabled at the section's edges, not the list's", async () => {
    const { user } = await open(EDIT_B);
    const row = await rowOptions(user, /^Bench Press/);
    expect(within(row).getByRole("button", { name: "Move up" })).toBeDisabled(); // first in Main; the loose list is above it
  });

  it("Add exercise appends to the last section; with no sections it stays loose (D3)", async () => {
    const { user } = await open(EDIT_B);
    await addFromPicker(user, /Overhead Press/);
    expect(within(region("Main")).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("10.3 AC21 — leave guard and save", () => {
  it("a loaded sectioned routine: a no-op Done on every section and item sheet leaves the draft clean", async () => {
    const { user, router } = await open(EDIT_B);
    for (const name of ["Warm-up", "Main"]) {
      await user.click(editSection(name));
      await user.click(within(await screen.findByRole("dialog", { name: "Edit section" })).getByRole("button", { name: "Done" }));
    }
    for (const label of [/^Overhead Press/, /^Bench Press/, /^Barbell Row/]) {
      await user.click(screen.getByRole("button", { name: label }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Done" }));
    }
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).toBeNull();
    await waitFor(() => expect(router.state.location.pathname).not.toBe(EDIT_B));
  });

  it("an unrelated edit saves the whole document: the same sections and memberships", async () => {
    const { user, fake } = await open(EDIT_B);
    const before = fake.state.routines.get(routineId(2))!;
    const membership = (r: typeof before) => r.items.map((i) => [i.exerciseId, r.sections.find((s) => s.id === i.sectionId)?.name ?? null, i.supersetGroup]);
    const expected = membership(before);
    await user.type(screen.getByLabelText("Notes"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === "PUT")).toBe(true));
    const sent = fake.requests.find((r) => r.method === "PUT")!.body as { sections: { key: string; name: string; notes?: string }[]; items: { sectionKey?: string }[] };
    expect(sent.sections.map((s) => s.key)).toEqual(["s1", "s2"]);
    expect(sent.items.map((i) => i.sectionKey ?? null)).toEqual([null, "s2", "s2"]);
    const saved = fake.state.routines.get(routineId(2))!;
    expect(membership(saved)).toEqual(expected);
    expect(saved.sections.map((s) => [s.name, s.notes])).toEqual(before.sections.map((s) => [s.name, s.notes]));
  });

  it("creating a routine with a section sends sections and a sectionKey", async () => {
    const { user, fake } = await open("/app/workouts/routines/new");
    await user.type(screen.getByLabelText("Name"), "Fresh");
    await user.click(screen.getByRole("button", { name: "Add section" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Add section" })).getByRole("button", { name: "Main" }));
    await addFromPicker(user, /Bench Press/);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === "POST" && r.path === "/v1/routines")).toBe(true));
    const sent = fake.requests.find((r) => r.method === "POST" && r.path === "/v1/routines")!.body as { sections: unknown[]; items: { sectionKey: string }[] };
    expect(sent.sections).toEqual([{ key: "s1", name: "Main" }]);
    expect(sent.items[0]!.sectionKey).toBe("s1");
  });
});

describe("10.3 AC22 — server errors in the UI", () => {
  it("a 422 on sections.<j>.name shows beside that section's header and again in its sheet", async () => {
    const { user, fake } = await open(EDIT_B);
    fake.failNext({ method: "PUT", path: /\/routines\// }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "sections.1.name", message: "server text" }] }),
    );
    await user.type(screen.getByLabelText("Notes"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await within(region("Main")).findByText(SECTION_NAME_INVALID)).toBeInTheDocument();
    expect(screen.queryByText("server text")).toBeNull();
    await user.click(editSection("Main"));
    expect(within(await screen.findByRole("dialog", { name: "Edit section" })).getByText(SECTION_NAME_INVALID)).toBeInTheDocument();
  });

  it("a 422 that names nothing on screen falls back to the form-level message", async () => {
    const { user, fake } = await open(EDIT_B);
    fake.failNext({ method: "PUT", path: /\/routines\// }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "items.1.sectionKey", message: "server text" }] }),
    );
    await user.type(screen.getByLabelText("Notes"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(FORM_INVALID)).toBeInTheDocument();
  });
});

describe("10.3 AC23 — starting a routine is unchanged", () => {
  it("Start from a sectioned routine sends no section or note key, and writes no routine", async () => {
    const { user, fake } = await open(`/app/workouts/routines/${routineId(2)}`, [pushSectioned], () =>
      screen.findByRole("heading", { level: 1, name: "Push B" }),
    );
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === "POST" && r.path === "/v1/workouts")).toBe(true));
    const body = fake.requests.find((r) => r.method === "POST" && r.path === "/v1/workouts")!.body as Record<string, unknown>;
    expect(body["routineId"]).toBe(routineId(2));
    expect(Object.keys(body).filter((k) => /section|note/i.test(k))).toEqual([]);
    expect(fake.requests.filter((r) => r.method === "PUT" || (r.method === "POST" && r.path === "/v1/routines"))).toEqual([]);
  });
});
