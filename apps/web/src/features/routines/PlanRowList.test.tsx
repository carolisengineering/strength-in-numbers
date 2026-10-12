import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PLANNED_SETS_PER_ITEM_MAX } from "@sin/core";
import { PlanRowList, SET_TYPE_CHOICES } from "./PlanRowList";
import { addRow, moveRow, removeRow, setRowField, setUnit, unitOfRows, type PlanRowText } from "./planRows";

const row = (key: string, o: Partial<PlanRowText> = {}): PlanRowText => ({ key, setType: "working", reps: "8", weight: "100", weightUnit: "kg", ...o });

function Harness({ initial, showReps = true, showWeight = true }: { initial: PlanRowText[]; showReps?: boolean; showWeight?: boolean }) {
  const [rows, setRows] = useState<readonly PlanRowText[]>(initial);
  let n = 0;
  return (
    <PlanRowList
      rows={rows}
      showReps={showReps}
      showWeight={showWeight}
      unit={unitOfRows(rows) ?? "kg"}
      errors={new Map()}
      onField={(key, patch) => setRows((r) => setRowField(r, key, patch))}
      onAdd={() => setRows((r) => addRow(r, `added${rows.length}-${++n}`))}
      onRemove={(key) => setRows((r) => removeRow(r, key))}
      onMove={(key, dir) => setRows((r) => moveRow(r, key, dir))}
      onUnit={(unit) => setRows((r) => setUnit(r, unit))}
    />
  );
}

const setup = (ui: React.ReactElement) => ({ user: userEvent.setup(), ...render(ui) });
const rowGroup = (n: number) => screen.getByRole("group", { name: `Set ${n}` });

describe("10.2 AC13 — plan rows", () => {
  it("is a real list of labeled groups; every control has a visible label naming its set", () => {
    setup(<Harness initial={[row("a", { setType: "warmup" }), row("b")]} />);
    const list = screen.getByRole("list", { name: "Planned sets" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    for (const n of [1, 2]) {
      const group = within(rowGroup(n));
      expect(group.getByLabelText(`Set ${n} type`)).toBeInTheDocument();
      expect(group.getByLabelText(`Set ${n} reps`)).toBeInTheDocument();
      expect(group.getByLabelText(`Set ${n} weight`)).toBeInTheDocument();
    }
    expect(within(rowGroup(1)).getByLabelText("Set 1 type")).toHaveValue("warmup");
    expect(within(rowGroup(2)).getByLabelText("Set 2 reps")).toHaveValue("8");
  });

  it("the type select offers Warm-up, Working, Drop, Failure", () => {
    setup(<Harness initial={[row("a")]} />);
    const options = within(screen.getByLabelText("Set 1 type")).getAllByRole("option").map((o) => o.textContent);
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
    expect(screen.getAllByRole("group", { name: /^Set \d+$/ })).toHaveLength(2);
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
    await user.click(screen.getByRole("button", { name: "Remove, set 1" }));
    expect(screen.getAllByRole("group", { name: /^Set \d+$/ })).toHaveLength(1);
    const only = screen.getByRole("button", { name: "Remove, set 1" });
    expect(only).toBeDisabled();
    expect(only).toHaveAccessibleDescription("A plan needs at least one set");
  });

  it("Move up / Move down reorder, and are disabled (not hidden) at the edges", async () => {
    const { user } = setup(<Harness initial={[row("a", { reps: "10" }), row("b", { reps: "8" }), row("c", { reps: "6" })]} />);
    expect(screen.getByRole("button", { name: "Move up, set 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move down, set 3" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move down, set 1" }));
    expect([1, 2, 3].map((n) => (screen.getByLabelText(`Set ${n} reps`) as HTMLInputElement).value)).toEqual(["8", "10", "6"]);
  });

  it("typing changes the row's text", async () => {
    const { user } = setup(<Harness initial={[row("a")]} />);
    const reps = screen.getByLabelText("Set 1 reps");
    await user.clear(reps);
    await user.type(reps, "5-8");
    expect(reps).toHaveValue("5-8");
    await user.selectOptions(screen.getByLabelText("Set 1 type"), "drop");
    expect(screen.getByLabelText("Set 1 type")).toHaveValue("drop");
  });

  it("one kg / lb toggle above the rows, pressed for the shared unit; choosing relabels every row", async () => {
    const { user } = setup(<Harness initial={[row("a"), row("b", { weight: "225" })]} />);
    const group = screen.getByRole("group", { name: "Weight unit" });
    expect(within(group).getByRole("button", { name: "kg" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "lb" })).toHaveAttribute("aria-pressed", "false");
    await user.click(within(group).getByRole("button", { name: "lb" }));
    expect(within(group).getByRole("button", { name: "lb" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Set 2 weight")).toHaveValue("225"); // relabeled, never converted
  });

  it("mixed units: neither segment pressed, a line says so, each row shows its own unit as text (D3)", async () => {
    const { user } = setup(<Harness initial={[row("a"), row("b", { weightUnit: "lb", weight: "225" })]} />);
    const group = screen.getByRole("group", { name: "Weight unit" });
    expect(within(group).getByRole("button", { name: "kg" })).toHaveAttribute("aria-pressed", "false");
    expect(within(group).getByRole("button", { name: "lb" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Mixed units — pick one to use for all sets")).toBeInTheDocument();
    expect(within(rowGroup(1)).getByText("kg")).toBeInTheDocument();
    expect(within(rowGroup(2)).getByText("lb")).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "kg" }));
    expect(screen.queryByText("Mixed units — pick one to use for all sets")).toBeNull();
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
    expect(screen.getByLabelText("Set 1 type")).toBeInTheDocument();
  });
});

describe("10.2 AC16 — row errors sit beside their fields", () => {
  it("renders a row's message as an alert tied to its input", () => {
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
    const reps = screen.getByLabelText("Set 2 reps");
    expect(reps).toHaveAttribute("aria-invalid", "true");
    expect(reps).toHaveAccessibleDescription("Enter reps like 8 or 8-10");
    expect(screen.getByLabelText("Set 2 weight")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Set 1 reps")).not.toHaveAttribute("aria-invalid");
  });
});
