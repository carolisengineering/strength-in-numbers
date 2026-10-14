import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { exerciseId } from "../../test/catalogFixtures";
import { ItemSheet } from "./ItemSheet";
import type { DraftItem, DraftSet } from "./routineDraft";

const set = (key: string, o: Partial<DraftSet> = {}): DraftSet => ({ key, setType: "working", repsLow: 8, repsHigh: 8, weight: 100, weightUnit: "kg", ...o });
const item = (plan: DraftSet[]): DraftItem => ({
  key: "k", exerciseId: exerciseId(1), targetSets: plan.length, targetRepsLow: 8, targetRepsHigh: 8, targetRpe: null, restSeconds: null,
  notes: null, supersetGroup: null, weight: null, weightUnit: null, plan, sectionKey: null,
});
const open = (plan: DraftSet[]) => render(<ItemSheet open title="Bench" item={item(plan)} modality="weight_reps" onDone={vi.fn()} onClose={vi.fn()} />);

describe("10.2 AC34 — the plan rows", () => {
  it("are a real list of labeled groups, and every control has a name that includes its set number", () => {
    open([set("a"), set("b"), set("c")]);
    const list = screen.getByRole("list", { name: "Planned sets" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    for (const control of list.querySelectorAll("input, select")) {
      expect(control).toHaveAccessibleName(/^Set \d+ (type|reps|weight)$/);
    }
    for (const button of within(list).getAllByRole("button")) {
      expect(button).toHaveAccessibleName(/, set \d+$/);
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
  it("the unit toggle is a labeled group of pressed-state buttons", () => {
    open([set("a")]);
    const group = screen.getByRole("group", { name: "Weight unit" });
    for (const button of within(group).getAllByRole("button")) expect(button).toHaveAttribute("aria-pressed");
  });
  it("every button is the shared Button (it carries the tap-target sizing)", () => {
    open([set("a"), set("b")]);
    for (const button of screen.getByRole("dialog").querySelectorAll("button")) {
      if (button.getAttribute("aria-label") === "Close" || button.textContent === "Close") continue;
      expect(button.className, button.textContent ?? "").not.toBe("");
    }
  });
});
