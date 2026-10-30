import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
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

import { templatesHandler } from "../../../test/hevyHarness";
import { cleanupSendScreen, setupSendScreen, WORKOUT_ID } from "../../../test/hevySendHarness";
import { EXERCISE_A, EXERCISE_B, sendFixture } from "../../../test/hevySendFakes";
import { server } from "../../../test/msw/server";
import { renderApp } from "../../../test/workoutHarness";

afterEach(() => {
  cleanup();
  cleanupSendScreen();
});

const TEMPLATES = [
  { id: "T-ROW2", title: "Bent Over Row (Barbell)", type: "weight_reps", is_custom: false },
  { id: "T-PLANK", title: "Plank", type: "duration", is_custom: false },
  { id: "T-BURPEE", title: "Burpee", type: "reps_only", is_custom: false },
];

/** Bench is paired; Row (weight_reps) is not — or, with `calories`, Echo Bike (Calories) is not. */
function setup(opts: { calories?: boolean } = {}) {
  const base = sendFixture();
  const detail = opts.calories
    ? { ...base.detail, exercises: [base.detail.exercises[0]!, { ...base.detail.exercises[1]!, exerciseNameSnapshot: "Echo Bike", modalitySnapshot: "calories" as const, sets: [] }] }
    : base.detail;
  const s = setupSendScreen(auth, { detail, mapping: { pairs: base.mapping.pairs.filter((p) => p.exerciseId === EXERCISE_A), sectionRules: [] } });
  server.use(templatesHandler(TEMPLATES));
  return s;
}

async function openSheet() {
  const view = renderApp(`/app/history/${WORKOUT_ID}`);
  await view.user.click(await screen.findByRole("button", { name: "Send to Hevy" }));
  const sheet = await screen.findByRole("dialog", { name: "Match exercises for Hevy" });
  return { ...view, sheet };
}

describe("20.2 AC13 — the sheet", () => {
  it("opens with its heading focused and one card per unmapped exercise; Continue waits for every choice", async () => {
    setup();
    const { sheet } = await openSheet();
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole("heading", { name: "Match exercises for Hevy" })));
    const card = within(sheet).getByRole("group", { name: "Row" });
    expect(within(card).getByText("Weight × reps · used in this workout")).toBeInTheDocument();
    expect(within(sheet).queryByRole("group", { name: "Bench Press" })).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("Pick lists only the acceptable Hevy exercises, searchable; Continue saves one PATCH and the send goes on", async () => {
    const s = setup();
    const { sheet, user } = await openSheet();
    const card = within(sheet).getByRole("group", { name: "Row" });
    await user.click(within(card).getByRole("button", { name: "Pick a Hevy exercise" }));
    expect(await within(card).findByRole("button", { name: "Bent Over Row (Barbell) · Weight & reps" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /^Plank/ })).toBeNull();
    await user.type(within(card).getByRole("searchbox", { name: "Search Hevy exercises" }), "zzz");
    expect(within(card).queryByRole("button", { name: /^Bent Over Row/ })).toBeNull();
    await user.clear(within(card).getByRole("searchbox", { name: "Search Hevy exercises" }));
    await user.click(within(card).getByRole("button", { name: "Bent Over Row (Barbell) · Weight & reps" }));
    await user.click(within(sheet).getByRole("button", { name: "Continue" }));
    expect(await within(await screen.findByRole("region", { name: "Hevy" })).findByText(/^Sent to Hevy · /)).toBeInTheDocument();
    expect(s.patches).toEqual([
      { upsert: [{ hevyTemplateId: "T-ROW2", hevyTitle: "Bent Over Row (Barbell)", hevyType: "weight_reps", role: "exercise", exerciseId: EXERCISE_B, measureRule: null, exportAs: true }] },
    ]);
    expect(s.hevy.writes()).toHaveLength(1);
  });

  it("Leave out only saves nothing; the send runs without it and says so", async () => {
    const s = setup();
    const { sheet, user } = await openSheet();
    await user.click(within(within(sheet).getByRole("group", { name: "Row" })).getByRole("button", { name: "Leave out of this workout" }));
    await user.click(within(sheet).getByRole("button", { name: "Continue" }));
    const region = await screen.findByRole("region", { name: "Hevy" });
    expect(await within(region).findByText("Row was left out.")).toBeInTheDocument();
    expect(s.patches).toEqual([]);
    expect((s.hevy.writes()[0]!.body as { workout: { exercises: unknown[] } }).workout.exercises).toHaveLength(1);
  });

  it("a PATCH that fails shows the mapping sentence in the sheet and sends nothing", async () => {
    const s = setup();
    s.failPatch(429);
    const { sheet, user } = await openSheet();
    const card = within(sheet).getByRole("group", { name: "Row" });
    await user.click(within(card).getByRole("button", { name: "Pick a Hevy exercise" }));
    await user.click(await within(card).findByRole("button", { name: "Bent Over Row (Barbell) · Weight & reps" }));
    await user.click(within(sheet).getByRole("button", { name: "Continue" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(/\S/);
    expect(s.link.log.filter((r) => r.method === "POST")).toEqual([]);
    expect(s.hevy.writes()).toEqual([]);
  });

  it("Cancel returns focus to Send to Hevy and writes nothing", async () => {
    const s = setup();
    const { sheet, user } = await openSheet();
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Match exercises for Hevy" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Send to Hevy" })));
    expect(s.patches).toEqual([]);
    expect(s.hevy.calls.filter((c) => c.op !== "list")).toEqual([]);
  });
});

describe("20.2 AC14 — Create in Hevy", () => {
  it("prefills the title and type, creates nothing until the confirm, then exactly one create (a double click too)", async () => {
    const s = setup({ calories: true });
    const { sheet, user } = await openSheet();
    const card = within(sheet).getByRole("group", { name: "Echo Bike" });
    await user.click(within(card).getByRole("button", { name: "Create in Hevy" }));
    expect(within(card).getByRole("textbox", { name: "Title" })).toHaveValue("Echo Bike (calories)");
    expect(within(card).getByRole("combobox", { name: "Hevy type" })).toHaveDisplayValue("Reps only");
    expect(within(card).getAllByRole("option").map((o) => o.textContent)).toEqual(["Reps only"]);
    expect(within(card).getByText("Hevy can't edit or delete an exercise after it's created. Check the details.")).toBeInTheDocument();
    expect(s.hevy.calls.filter((c) => c.op === "template")).toEqual([]);
    const confirm = within(card).getByRole("button", { name: "Create in Hevy" });
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(await within(card).findByText("Created in Hevy.")).toBeInTheDocument();
    expect(s.hevy.calls.filter((c) => c.op === "template")).toHaveLength(1);
    await user.click(within(sheet).getByRole("button", { name: "Continue" }));
    await within(await screen.findByRole("region", { name: "Hevy" })).findByText(/^Sent to Hevy · /);
    expect(s.patches).toEqual([
      { upsert: [{ hevyTemplateId: "t1", hevyTitle: "Echo Bike (calories)", hevyType: "reps_only", role: "exercise", exerciseId: EXERCISE_B, measureRule: "calories_as_reps", exportAs: true }] },
    ]);
  });

  it("the custom exercise limit says so and returns the card to its choices", async () => {
    const s = setup({ calories: true });
    s.hevy.fail("template", "403-limit");
    const { sheet, user } = await openSheet();
    const card = within(sheet).getByRole("group", { name: "Echo Bike" });
    await user.click(within(card).getByRole("button", { name: "Create in Hevy" }));
    await user.click(within(card).getByRole("button", { name: "Create in Hevy" }));
    expect(await within(card).findByText("Your Hevy account has reached its custom exercise limit.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Pick a Hevy exercise" })).toBeInTheDocument();
  });

  it("another failure shows the static sentence, keeps the draft, and is not retried", async () => {
    const s = setup({ calories: true });
    s.hevy.fail("template", "5xx");
    const { sheet, user } = await openSheet();
    const card = within(sheet).getByRole("group", { name: "Echo Bike" });
    await user.click(within(card).getByRole("button", { name: "Create in Hevy" }));
    await user.clear(within(card).getByRole("textbox", { name: "Title" }));
    await user.type(within(card).getByRole("textbox", { name: "Title" }), "Echo Bike Cals");
    await user.click(within(card).getByRole("button", { name: "Create in Hevy" }));
    expect(await within(card).findByText("Hevy is having trouble right now. Try again later.")).toBeInTheDocument();
    expect(within(card).getByRole("textbox", { name: "Title" })).toHaveValue("Echo Bike Cals");
    expect(s.hevy.calls.filter((c) => c.op === "template")).toHaveLength(1);
  });
});
