import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { exerciseId } from "../../test/catalogFixtures";
import { openRow, summaryButton } from "../../test/planRowHelpers";
import { ItemSheet } from "./ItemSheet";
import type { RowErrors } from "./planRows";
import type { DraftItem, DraftSet } from "./routineDraft";

const set = (key: string, o: Partial<DraftSet> = {}): DraftSet => ({ key, setType: "working", repsLow: 5, repsHigh: 5, weight: 80, weightUnit: "kg", ...o });
const PLAN = [set("a"), set("b"), set("c"), set("d"), set("e")];
const item = (o: Partial<DraftItem> = {}): DraftItem => ({
  key: "k", exerciseId: exerciseId(1), targetSets: 5, targetRepsLow: 5, targetRepsHigh: 5, targetRpe: null,
  restSeconds: null, notes: null, supersetGroup: null, weight: null, weightUnit: null, plan: PLAN, sectionKey: null, ...o,
});

function setup(rowMessages?: ReadonlyMap<string, RowErrors>) {
  const onDone = vi.fn();
  render(
    <ItemSheet open title="Bench Press" item={item()} modality="weight_reps" onDone={onDone} onClose={vi.fn()} {...(rowMessages ? { rowMessages } : {})} />,
  );
  return { onDone, user: userEvent.setup() };
}
const openGroups = () => screen.queryAllByRole("group", { name: /^Set \d+$/ }).map((g) => g.getAttribute("aria-label"));
const done = () => screen.getByRole("button", { name: "Done" });

async function typeInto(user: ReturnType<typeof userEvent.setup>, n: number, field: "reps" | "weight", text: string) {
  await openRow(user, n);
  const input = screen.getByLabelText(`Set ${n} ${field}`);
  await user.clear(input);
  await user.type(input, text);
}

describe("17.11 AC16 — Done with an invalid row opens it and focuses its first invalid field", () => {
  it("row 3's reps: the sheet stays open, row 3 opens, focus is on its Reps", async () => {
    const { onDone, user } = setup();
    await typeInto(user, 3, "reps", "abc");
    await openRow(user, 1);
    await user.click(done());
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(openGroups()).toEqual(["Set 3"]);
    expect(screen.getByLabelText("Set 3 reps")).toHaveFocus();
    expect(within(screen.getByRole("group", { name: "Set 3" })).getByRole("alert")).toBeInTheDocument();
  });

  it("only the weight invalid: focus is on Weight", async () => {
    const { user } = setup();
    await typeInto(user, 2, "weight", "4o");
    await user.click(summaryButton(2));
    await user.click(done());
    expect(openGroups()).toEqual(["Set 2"]);
    expect(screen.getByLabelText("Set 2 weight")).toHaveFocus();
  });

  it("a collapsed invalid row says 'Check this set' in its name", async () => {
    const { user } = setup();
    await typeInto(user, 2, "reps", "abc");
    await typeInto(user, 4, "reps", "9-3");
    await user.click(done());
    expect(summaryButton(4)).toHaveAccessibleName("4 · Working · 9-3 · 80 kg · Check this set");
    expect(summaryButton(3)).toHaveAccessibleName("3 · Working · 5 reps · 80 kg");
  });
});

describe("17.11 AC16 — several invalid rows, Done after Done", () => {
  it("rows 2 and 4: Done focuses 2; fixing 2, Done focuses 4; Done again with 4 open focuses it again", async () => {
    const { onDone, user } = setup();
    await typeInto(user, 2, "reps", "abc");
    await typeInto(user, 4, "weight", "x");
    await user.click(done());
    expect(screen.getByLabelText("Set 2 reps")).toHaveFocus();
    await user.clear(screen.getByLabelText("Set 2 reps"));
    await user.type(screen.getByLabelText("Set 2 reps"), "5");
    await user.click(done());
    expect(openGroups()).toEqual(["Set 4"]);
    expect(screen.getByLabelText("Set 4 weight")).toHaveFocus();
    await user.click(done());
    expect(screen.getByLabelText("Set 4 weight")).toHaveFocus();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("only Rest invalid: no row opens and no row error shows", async () => {
    const { onDone, user } = setup();
    await user.type(screen.getByLabelText("Rest"), "abc");
    await user.click(done());
    expect(onDone).not.toHaveBeenCalled();
    expect(openGroups()).toEqual([]);
    expect(screen.getByLabelText("Rest")).toHaveAttribute("aria-invalid", "true");
    for (const n of [1, 2, 3, 4, 5]) expect(summaryButton(n)).not.toHaveAccessibleName(/Check this set/);
  });
});

describe("minor 521 — a row's error clears when that field changes", () => {
  it("editing a flagged row's Reps hides its message and, once closed, its suffix; focus stays; the other row keeps both", async () => {
    const { user } = setup();
    await typeInto(user, 2, "reps", "abc");
    await typeInto(user, 4, "reps", "9-3");
    await user.click(done());
    const reps2 = screen.getByLabelText("Set 2 reps");
    expect(reps2).toHaveFocus();
    await user.type(reps2, "{Backspace}");
    expect(reps2).toHaveFocus();
    expect(reps2).not.toHaveAttribute("aria-invalid", "true");
    expect(within(screen.getByRole("group", { name: "Set 2" })).queryByRole("alert")).toBeNull();
    expect(openGroups()).toEqual(["Set 2"]);
    await user.click(summaryButton(2));
    expect(summaryButton(2)).not.toHaveAccessibleName(/Check this set/);
    expect(summaryButton(4)).toHaveAccessibleName(/Check this set/);
  });

  it("the open row never says Check this set", async () => {
    const { user } = setup();
    await typeInto(user, 3, "reps", "abc");
    await user.click(done());
    expect(openGroups()).toEqual(["Set 3"]);
    expect(summaryButton(3)).not.toHaveAccessibleName(/Check this set/);
    await user.click(summaryButton(3));
    expect(summaryButton(3)).toHaveAccessibleName(/Check this set/);
  });
});

describe("17.11 AC16 — an item opened with a message on a row", () => {
  it("starts with that row open, and leaves focus where the sheet put it, not on the field", () => {
    setup(new Map([["b", { weight: "Check the weight" }]]));
    expect(openGroups()).toEqual(["Set 2"]);
    expect(screen.getByLabelText("Set 2 weight")).toHaveAccessibleDescription(/Check the weight/);
    expect(screen.getByLabelText("Set 2 weight")).not.toHaveFocus();
  });
});
