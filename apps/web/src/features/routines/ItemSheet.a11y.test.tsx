import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { exerciseId } from "../../test/catalogFixtures";
import { openRow } from "../../test/planRowHelpers";
import { ItemSheet } from "./ItemSheet";
import type { DraftItem, DraftSet } from "./routineDraft";

const set = (key: string, o: Partial<DraftSet> = {}): DraftSet => ({ key, setType: "working", repsLow: 8, repsHigh: 8, weight: 100, weightUnit: "kg", ...o });
const item = (plan: DraftSet[]): DraftItem => ({
  key: "k", exerciseId: exerciseId(1), targetSets: plan.length, targetRepsLow: 8, targetRepsHigh: 8, targetRpe: null, restSeconds: null,
  notes: null, supersetGroup: null, weight: null, weightUnit: null, plan, sectionKey: null,
});
const open = (plan: DraftSet[]) => render(<ItemSheet open title="Bench" item={item(plan)} modality="weight_reps" onDone={vi.fn()} onClose={vi.fn()} />);

describe("10.2 AC34 — the plan rows", () => {
  it("are a real list of labeled groups, and every control has a name that includes its set number", async () => {
    const user = userEvent.setup();
    open([set("a"), set("b"), set("c")]);
    const list = screen.getByRole("list", { name: "Planned sets" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    // Spec 17.11: only the open row draws its controls, so each row is checked open, in turn.
    for (const n of [1, 2, 3]) {
      await openRow(user, n);
      const panel = screen.getByRole("group", { name: `Set ${n}` });
      for (const control of panel.querySelectorAll("input:not([type=radio]), select")) {
        expect(control).toHaveAccessibleName(new RegExp(`^Set ${n} (reps|weight)$`));
      }
      // Spec 17.7: a row's type is a Segmented; its radios are named by the option, and their group by the set.
      const radios = panel.querySelectorAll("input[type=radio]");
      expect(radios).toHaveLength(4);
      for (const radio of radios) expect(radio.closest("fieldset")).toHaveAccessibleName(`Set ${n} type`);
      for (const button of within(panel).getAllByRole("button")) {
        expect(button).toHaveAccessibleName(new RegExp(`, set ${n}$`));
      }
    }
  });
  it("every control in the sheet has a programmatic label", () => {
    open([set("a"), set("b")]);
    for (const control of screen.getByRole("dialog").querySelectorAll("input, select, textarea")) expect(control).toHaveAccessibleName();
  });
  it("disabled controls are `disabled` and say why in text, not in a tooltip", () => {
    open([set("a")]);
    const remove = screen.getByRole("button", { name: "Remove, set 1" });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAccessibleDescription("A plan needs at least one set");
    expect(remove).not.toHaveAttribute("title");
    expect(screen.getByRole("button", { name: "Move up, set 1" })).toBeDisabled();
  });
  it("17.7 AC6 — the unit is a labeled group of radios with a checked state", () => {
    open([set("a")]);
    const group = screen.getByRole("group", { name: "Weight unit" });
    expect(within(group).queryAllByRole("button")).toHaveLength(0);
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(within(group).getByRole("radio", { name: "kg" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "lb" })).not.toBeChecked();
  });
  it("every button is the shared Button (it carries the tap-target sizing)", () => {
    open([set("a"), set("b")]);
    for (const button of screen.getByRole("dialog").querySelectorAll("button")) {
      if (button.getAttribute("aria-label") === "Close" || button.textContent === "Close") continue;
      expect(button.className, button.textContent ?? "").not.toBe("");
    }
  });
});
