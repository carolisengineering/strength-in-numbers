import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { openRow, summaryButton, summaryButtons } from "../../test/planRowHelpers";
import { PlanRowList } from "./PlanRowList";
import { addRow, moveRow, removeRow, setRowField, setUnit, unitOfRows, type PlanRowText } from "./planRows";

const row = (key: string, reps: string): PlanRowText => ({ key, setType: "working", reps, weight: "100", weightUnit: "kg" });
const FOUR = [row("a", "10"), row("b", "8"), row("c", "6"), row("d", "4")];
const THREE = FOUR.slice(0, 3);

function Harness({ initial }: { initial: PlanRowText[] }) {
  const [rows, setRows] = useState<readonly PlanRowText[]>(initial);
  return (
    <PlanRowList
      rows={rows}
      showReps
      showWeight
      unit={unitOfRows(rows) ?? "kg"}
      errors={new Map()}
      onField={(key, patch) => setRows((r) => setRowField(r, key, patch))}
      onAdd={(key) => setRows((r) => addRow(r, key))}
      onRemove={(key) => setRows((r) => removeRow(r, key))}
      onMove={(key, dir) => setRows((r) => moveRow(r, key, dir))}
      onUnit={(unit) => setRows((r) => setUnit(r, unit))}
    />
  );
}

const setup = (initial: PlanRowText[]) => ({ user: userEvent.setup(), ...render(<Harness initial={initial} />) });
const openGroups = () => screen.queryAllByRole("group", { name: /^Set \d+$/ }).map((g) => g.getAttribute("aria-label"));

describe("17.11 AC17 — focus survives Move", () => {
  it("Move down on row 2 keeps focus on Move down, now named for set 3, and the row stays open", async () => {
    const { user } = setup(FOUR);
    await openRow(user, 2);
    await user.click(screen.getByRole("button", { name: "Move down, set 2" }));
    expect(screen.getByRole("button", { name: "Move down, set 3" })).toHaveFocus();
    expect(openGroups()).toEqual(["Set 3"]);
    expect(summaryButton(3)).toHaveAccessibleName("3 · Working · 8 reps · 100 kg");
  });

  it("Move up on row 3 keeps focus on Move up, now named for set 2", async () => {
    const { user } = setup(FOUR);
    await openRow(user, 3);
    await user.click(screen.getByRole("button", { name: "Move up, set 3" }));
    expect(screen.getByRole("button", { name: "Move up, set 2" })).toHaveFocus();
  });

  it("Move down into the last place: Move down is now disabled, so focus goes to the row's summary", async () => {
    const { user } = setup(THREE);
    await openRow(user, 2);
    await user.click(screen.getByRole("button", { name: "Move down, set 2" }));
    expect(screen.getByRole("button", { name: "Move down, set 3" })).toBeDisabled();
    expect(summaryButton(3)).toHaveFocus();
    expect(openGroups()).toEqual(["Set 3"]);
  });

  it("Move up into the first place: focus goes to the row's summary", async () => {
    const { user } = setup(THREE);
    await openRow(user, 2);
    await user.click(screen.getByRole("button", { name: "Move up, set 2" }));
    expect(summaryButton(1)).toHaveFocus();
    expect(summaryButton(1)).toHaveAccessibleName("1 · Working · 8 reps · 100 kg");
  });
});

describe("17.11 AC17 — focus after Remove and Add set", () => {
  it("Remove row 2 of 3: focus on the summary of the row now second, every row closed", async () => {
    const { user } = setup(THREE);
    await openRow(user, 2);
    await user.click(screen.getByRole("button", { name: "Remove, set 2" }));
    expect(summaryButtons()).toHaveLength(2);
    expect(summaryButton(2)).toHaveAccessibleName("2 · Working · 6 reps · 100 kg");
    expect(summaryButton(2)).toHaveFocus();
    expect(openGroups()).toEqual([]);
  });

  it("Remove the last row: focus on the previous row's summary", async () => {
    const { user } = setup(THREE);
    await openRow(user, 3);
    await user.click(screen.getByRole("button", { name: "Remove, set 3" }));
    expect(summaryButtons()).toHaveLength(2);
    expect(summaryButton(2)).toHaveFocus();
    expect(openGroups()).toEqual([]);
  });

  it("only the open row has Remove, so no other row's typing can be lost to it", async () => {
    const { user } = setup(THREE);
    await openRow(user, 1);
    expect(screen.getAllByRole("button", { name: /^Remove, set / })).toHaveLength(1);
  });

  it("Add set: the new row is open and focus is on its Type's checked radio", async () => {
    const { user } = setup(THREE);
    await user.click(screen.getByRole("button", { name: "Add set" }));
    expect(openGroups()).toEqual(["Set 4"]);
    const type = within(screen.getByRole("group", { name: "Set 4" })).getByRole("group", { name: "Set 4 type" });
    expect(within(type).getByRole("radio", { name: "Working" })).toBeChecked();
    expect(within(type).getByRole("radio", { name: "Working" })).toHaveFocus();
  });
});
