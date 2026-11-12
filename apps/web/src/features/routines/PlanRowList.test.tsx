import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PLANNED_SETS_PER_ITEM_MAX } from "@sin/core";
import { chooseSegment, segmentChoice, segmented, segmentOptions } from "../../test/controls";
import { openRow, summaryButtons } from "../../test/planRowHelpers";
import { PlanRowList } from "./PlanRowList";
import { SET_TYPE_CHOICES } from "./planRowSummary";
import { addRow, moveRow, removeRow, setRowField, setUnit, unitOfRows, type PlanRowText } from "./planRows";

const row = (key: string, o: Partial<PlanRowText> = {}): PlanRowText => ({ key, setType: "working", reps: "8", weight: "100", weightUnit: "kg", ...o });

function Harness({ initial, showReps = true, showWeight = true }: { initial: PlanRowText[]; showReps?: boolean; showWeight?: boolean }) {
  const [rows, setRows] = useState<readonly PlanRowText[]>(initial);
  return (
    <PlanRowList
      rows={rows}
      showReps={showReps}
      showWeight={showWeight}
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

const setup = (ui: React.ReactElement) => ({ user: userEvent.setup(), ...render(ui) });
const rowGroup = (n: number) => screen.getByRole("group", { name: `Set ${n}` });

describe("10.2 AC13 — plan rows", () => {
  it("is a real list of labeled groups; every control has a visible label naming its set", async () => {
    const { user } = setup(<Harness initial={[row("a", { setType: "warmup" }), row("b")]} />);
    const list = screen.getByRole("list", { name: "Planned sets" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    for (const n of [1, 2]) {
      await openRow(user, n);
      const group = within(rowGroup(n));
      expect(segmented(`Set ${n} type`, group)).toBeInTheDocument();
      expect(group.getByLabelText(`Set ${n} reps`)).toBeInTheDocument();
      expect(group.getByLabelText(`Set ${n} weight`)).toBeInTheDocument();
    }
    await openRow(user, 1);
    expect(segmentChoice("Set 1 type", rowGroup(1))).toBe("warmup");
    await openRow(user, 2);
    expect(within(rowGroup(2)).getByLabelText("Set 2 reps")).toHaveValue("8");
  });

  it("17.7 AC6 — Set k type is four radios: Warm-up, Working, Drop, Failure", () => {
    setup(<Harness initial={[row("a")]} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    const options = segmentOptions("Set 1 type");
    expect(options).toEqual(SET_TYPE_CHOICES.map((c) => c.label));
    expect(options).toEqual(["Warm-up", "Working", "Drop", "Failure"]);
  });

  it("numeric fields are text inputs with the right keypad; never type=number", () => {
    setup(<Harness initial={[row("a")]} />);
    expect(screen.getByLabelText("Set 1 reps")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Set 1 weight")).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByLabelText("Set 1 weight")).toHaveAttribute("type", "text");
  });

  it("Add set appends a row copying the last one", async () => {
    const { user } = setup(<Harness initial={[row("a", { reps: "6", weight: "100" })]} />);
    await user.click(screen.getByRole("button", { name: "Add set" }));
    expect(summaryButtons()).toHaveLength(2);
    await openRow(user, 2);
    expect(screen.getByLabelText("Set 2 reps")).toHaveValue("6");
    expect(screen.getByLabelText("Set 2 weight")).toHaveValue("100");
  });

  it("at 20 rows Add set is disabled and says why", () => {
    setup(<Harness initial={Array.from({ length: PLANNED_SETS_PER_ITEM_MAX }, (_, i) => row(`r${i}`))} />);
    const add = screen.getByRole("button", { name: "Add set" });
    expect(add).toBeDisabled();
    expect(screen.getByText("Up to 20 sets")).toBeInTheDocument();
    expect(add).toHaveAccessibleDescription("Up to 20 sets");
  });

  it("Remove is disabled on the only row, with the reason in text", async () => {
    const { user } = setup(<Harness initial={[row("a"), row("b")]} />);
    expect(screen.queryByText("A plan needs at least one set")).toBeNull();
    await openRow(user, 1);
    await user.click(screen.getByRole("button", { name: "Remove, set 1" }));
    expect(summaryButtons()).toHaveLength(1);
    await openRow(user, 1);
    const only = screen.getByRole("button", { name: "Remove, set 1" });
    expect(only).toBeDisabled();
    expect(only).toHaveAccessibleDescription("A plan needs at least one set");
  });

  it("Move up / Move down reorder, and are disabled (not hidden) at the edges", async () => {
    const { user } = setup(<Harness initial={[row("a", { reps: "10" }), row("b", { reps: "8" }), row("c", { reps: "6" })]} />);
    await openRow(user, 1);
    expect(screen.getByRole("button", { name: "Move up, set 1" })).toBeDisabled();
    await openRow(user, 3);
    expect(screen.getByRole("button", { name: "Move down, set 3" })).toBeDisabled();
    await openRow(user, 1);
    await user.click(screen.getByRole("button", { name: "Move down, set 1" }));
    const values: string[] = [];
    for (const n of [1, 2, 3]) {
      await openRow(user, n);
      values.push((screen.getByLabelText(`Set ${n} reps`) as HTMLInputElement).value);
    }
    expect(values).toEqual(["8", "10", "6"]);
  });

  it("typing changes the row's text", async () => {
    const { user } = setup(<Harness initial={[row("a")]} />);
    const reps = screen.getByLabelText("Set 1 reps");
    await user.clear(reps);
    await user.type(reps, "5-8");
    expect(reps).toHaveValue("5-8");
    await chooseSegment(user, "Set 1 type", "Drop");
    expect(segmentChoice("Set 1 type")).toBe("drop");
  });

  it("17.7 AC6 — one kg / lb strip above the rows, checked for the shared unit; choosing relabels every row", async () => {
    const { user } = setup(<Harness initial={[row("a"), row("b", { weight: "225" })]} />);
    const group = segmented("Weight unit");
    expect(within(group).queryAllByRole("button")).toHaveLength(0);
    expect(within(group).getByRole("radio", { name: "kg" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "lb" })).not.toBeChecked();
    await user.click(within(group).getByRole("radio", { name: "lb" }));
    expect(within(group).getByRole("radio", { name: "lb" })).toBeChecked();
    await openRow(user, 2);
    expect(screen.getByLabelText("Set 2 weight")).toHaveValue("225"); // relabeled, never converted
  });

  it("17.7 AC3 — mixed units: neither radio checked, a line says so, each row shows its own unit as text (D3)", async () => {
    const { user } = setup(<Harness initial={[row("a"), row("b", { weightUnit: "lb", weight: "225" })]} />);
    const group = segmented("Weight unit");
    expect(within(group).getByRole("radio", { name: "kg" })).not.toBeChecked();
    expect(within(group).getByRole("radio", { name: "lb" })).not.toBeChecked();
    expect(screen.getByText("Mixed units — pick one to use for all sets")).toBeInTheDocument();
    await openRow(user, 1);
    expect(within(rowGroup(1)).getByText("kg")).toBeInTheDocument();
    await openRow(user, 2);
    expect(within(rowGroup(2)).getByText("lb")).toBeInTheDocument();
    await user.click(within(group).getByRole("radio", { name: "kg" }));
    expect(screen.queryByText("Mixed units — pick one to use for all sets")).toBeNull();
    expect(within(group).getByRole("radio", { name: "kg" })).toBeChecked();
  });

  it("17.7 AC6 — choosing one row's type leaves the other rows and the unit as they were", async () => {
    const { user } = setup(<Harness initial={[row("a", { setType: "warmup" }), row("b"), row("c", { setType: "failure" })]} />);
    await openRow(user, 2);
    await chooseSegment(user, "Set 2 type", "Drop");
    await openRow(user, 1);
    expect(segmentChoice("Set 1 type")).toBe("warmup");
    await openRow(user, 2);
    expect(segmentChoice("Set 2 type")).toBe("drop");
    await openRow(user, 3);
    expect(segmentChoice("Set 3 type")).toBe("failure");
    expect(segmentChoice("Weight unit")).toBe("kg");
  });
});

describe("10.2 AC11 — fields gated by what the exercise carries", () => {
  it("bodyweight rows have no weight and no unit toggle", () => {
    setup(<Harness initial={[row("a")]} showWeight={false} />);
    expect(screen.queryByLabelText("Set 1 weight")).toBeNull();
    expect(screen.queryByRole("group", { name: "Weight unit" })).toBeNull();
    expect(screen.getByLabelText("Set 1 reps")).toBeInTheDocument();
  });
  it("timed rows show the type only", () => {
    setup(<Harness initial={[row("a")]} showReps={false} showWeight={false} />);
    expect(screen.queryByLabelText("Set 1 reps")).toBeNull();
    expect(screen.queryByLabelText("Set 1 weight")).toBeNull();
    expect(segmented("Set 1 type")).toBeInTheDocument();
  });
});

describe("10.2 AC16 — row errors sit beside their fields", () => {
  it("renders a row's message as an alert tied to its input", async () => {
    const user = userEvent.setup();
    render(
      <PlanRowList
        rows={[row("a"), row("b")]}
        showReps
        showWeight
        unit="kg"
        errors={new Map([["b", { reps: "Enter reps like 8 or 8-10", weight: "Enter a weight like 62.5" }]])}
        onField={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        onMove={() => {}}
        onUnit={() => {}}
      />,
    );
    await openRow(user, 2);
    const reps = screen.getByLabelText("Set 2 reps");
    expect(reps).toHaveAttribute("aria-invalid", "true");
    expect(reps).toHaveAccessibleDescription("Enter reps like 8 or 8-10");
    expect(screen.getByLabelText("Set 2 weight")).toHaveAttribute("aria-invalid", "true");
    await openRow(user, 1);
    expect(screen.getByLabelText("Set 1 reps")).not.toHaveAttribute("aria-invalid");
  });
});
