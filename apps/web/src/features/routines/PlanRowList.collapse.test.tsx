import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PLANNED_SETS_PER_ITEM_MAX } from "@sin/core";
import { chooseSegment, segmentChoice, segmented } from "../../test/controls";
import { openRow, summaryButton, summaryButtons } from "../../test/planRowHelpers";
import { stripCssComments } from "../../test/sourceScan";
import { PlanRowList } from "./PlanRowList";
import { addRow, moveRow, removeRow, setRowField, setUnit, unitOfRows, type PlanRowText, type RowErrors } from "./planRows";

const row = (key: string, o: Partial<PlanRowText> = {}): PlanRowText => ({ key, setType: "working", reps: "8", weight: "100", weightUnit: "kg", ...o });

function Harness({
  initial,
  errors = new Map(),
  openFirst = false,
  showReps = true,
  showWeight = true,
  fallbackUnit,
}: {
  initial: PlanRowText[];
  errors?: ReadonlyMap<string, RowErrors>;
  openFirst?: boolean;
  showReps?: boolean;
  showWeight?: boolean;
  fallbackUnit?: "kg" | "lb";
}) {
  const [rows, setRows] = useState<readonly PlanRowText[]>(initial);
  return (
    <PlanRowList
      rows={rows}
      showReps={showReps}
      showWeight={showWeight}
      unit={unitOfRows(rows) ?? "kg"}
      errors={errors}
      openFirst={openFirst}
      {...(fallbackUnit ? { fallbackUnit } : {})}
      onField={(key, patch) => setRows((r) => setRowField(r, key, patch))}
      onAdd={(key) => setRows((r) => addRow(r, key))}
      onRemove={(key) => setRows((r) => removeRow(r, key))}
      onMove={(key, dir) => setRows((r) => moveRow(r, key, dir))}
      onUnit={(unit) => setRows((r) => setUnit(r, unit))}
    />
  );
}

const setup = (ui: React.ReactElement) => ({ user: userEvent.setup(), ...render(ui) });
const THREE = [row("a", { setType: "warmup", reps: "10", weight: "60" }), row("b"), row("c", { reps: "6" })];
const openGroup = () => screen.queryAllByRole("group", { name: /^Set \d+$/ });

const HERE = dirname(fileURLToPath(import.meta.url));
const css = stripCssComments(readFileSync(join(HERE, "PlanRowList.module.css"), "utf8"));
const rule = (selector: string) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1]!.split(",").map((s) => s.trim()).includes(selector))?.[2] ?? "";

describe("17.11 AC11 — one line per set", () => {
  it("each row is one button whose name is the set's summary", () => {
    setup(<Harness initial={THREE} />);
    const items = within(screen.getByRole("list", { name: "Planned sets" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    for (const item of items) expect(within(item).getAllByRole("button")).toHaveLength(1);
    expect(summaryButtons().map((b) => b.textContent)).toEqual(["1 · Warm-up · 10 reps · 60 kg", "2 · Working · 8 reps · 100 kg", "3 · Working · 6 reps · 100 kg"]);
    for (const button of summaryButtons()) expect(button).toHaveAttribute("type", "button");
  });

  it("the summary is at least the tap-target height", () => {
    expect(rule(".summary")).toMatch(/min-height:\s*var\(--tap-target-min\)/);
  });

  it("minor 520 — the panel's cells start at the top, so a Reps error doesn't stretch Weight", () => {
    expect(rule(".panel")).toMatch(/align-items:\s*start/);
    expect(rule(".withUnit")).toMatch(/align-items:\s*flex-end/);
  });

  it("minor 523 — an edge note sits in a line with its button", () => {
    expect(rule(".edge")).toMatch(/display:\s*inline-flex/);
    expect(rule(".edge")).toMatch(/align-items:\s*center/);
  });

  it("follows the exercise's type: a timed exercise shows the set type only", () => {
    setup(<Harness initial={THREE} showReps={false} showWeight={false} />);
    expect(summaryButtons().map((b) => b.textContent)).toEqual(["1 · Warm-up", "2 · Working", "3 · Working"]);
  });
});

describe("17.11 AC12 — a row opens in place, one at a time", () => {
  it("aria-expanded and aria-controls follow the state; the panel exists only while open", async () => {
    const { user } = setup(<Harness initial={THREE} />);
    const first = summaryButton(1);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(first).not.toHaveAttribute("aria-controls");
    expect(openGroup()).toHaveLength(0);
    await user.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(first.getAttribute("aria-controls")!);
    expect(panel).toBe(screen.getByRole("group", { name: "Set 1" }));
    expect(within(panel!).getByLabelText("Set 1 reps")).toHaveValue("10");
  });

  it("opening row 2 closes row 1, and what was typed in row 1 stays on its line", async () => {
    const { user } = setup(<Harness initial={THREE} />);
    await openRow(user, 1);
    await user.clear(screen.getByLabelText("Set 1 reps"));
    await user.type(screen.getByLabelText("Set 1 reps"), "12");
    await openRow(user, 2);
    expect(summaryButton(1)).toHaveAttribute("aria-expanded", "false");
    expect(summaryButton(1)).toHaveAccessibleName("1 · Warm-up · 12 reps · 60 kg");
    expect(openGroup().map((g) => g.getAttribute("aria-label"))).toEqual(["Set 2"]);
    await openRow(user, 1);
    expect(screen.getByLabelText("Set 1 reps")).toHaveValue("12");
  });

  it("a tap on the open row's summary closes it", async () => {
    const { user } = setup(<Harness initial={THREE} />);
    await openRow(user, 2);
    await user.click(summaryButton(2));
    expect(summaryButton(2)).toHaveAttribute("aria-expanded", "false");
    expect(openGroup()).toHaveLength(0);
  });

  it("several rows start closed; one row starts open; openFirst opens the first", () => {
    const { unmount } = setup(<Harness initial={THREE} />);
    expect(openGroup()).toHaveLength(0);
    unmount();
    const one = setup(<Harness initial={[row("a")]} />);
    expect(openGroup().map((g) => g.getAttribute("aria-label"))).toEqual(["Set 1"]);
    one.unmount();
    setup(<Harness initial={THREE} openFirst />);
    expect(openGroup().map((g) => g.getAttribute("aria-label"))).toEqual(["Set 1"]);
  });
});

describe("17.11 AC13 — no operation is lost (10.2 AC13 through an open row)", () => {
  it("Add set adds a row, and is disabled at the cap with its reason", async () => {
    const { user } = setup(<Harness initial={Array.from({ length: PLANNED_SETS_PER_ITEM_MAX - 1 }, (_, i) => row(`r${i}`))} />);
    await user.click(screen.getByRole("button", { name: "Add set" }));
    expect(summaryButtons()).toHaveLength(PLANNED_SETS_PER_ITEM_MAX);
    const add = screen.getByRole("button", { name: "Add set" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(`Up to ${PLANNED_SETS_PER_ITEM_MAX} sets`);
  });

  it("Remove is disabled on the only row with its reason, and removes a row otherwise", async () => {
    const { user, unmount } = setup(<Harness initial={[row("a")]} />);
    const only = screen.getByRole("button", { name: "Remove, set 1" });
    expect(only).toBeDisabled();
    expect(only).toHaveAccessibleDescription("A plan needs at least one set");
    unmount();
    setup(<Harness initial={THREE} />);
    await openRow(user, 2);
    await user.click(screen.getByRole("button", { name: "Remove, set 2" }));
    expect(summaryButtons().map((b) => b.textContent)).toEqual(["1 · Warm-up · 10 reps · 60 kg", "2 · Working · 6 reps · 100 kg"]);
  });

  it("Move swaps neighbors and is disabled at the edges", async () => {
    const { user } = setup(<Harness initial={THREE} />);
    await openRow(user, 1);
    expect(screen.getByRole("button", { name: "Move up, set 1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move down, set 1" }));
    expect(summaryButtons().map((b) => b.textContent)).toEqual(["1 · Working · 8 reps · 100 kg", "2 · Warm-up · 10 reps · 60 kg", "3 · Working · 6 reps · 100 kg"]);
    await openRow(user, 3);
    expect(screen.getByRole("button", { name: "Move down, set 3" })).toBeDisabled();
  });

  it("the unit Segmented shows the mixed state and its note; each row shows its own unit while mixed", async () => {
    const { user } = setup(<Harness initial={[row("a"), row("b", { weightUnit: "lb" })]} />);
    expect(segmentChoice("Weight unit")).toBeNull();
    expect(screen.getByText("Mixed units — pick one to use for all sets")).toBeInTheDocument();
    expect(summaryButtons().map((b) => b.textContent)).toEqual(["1 · Working · 8 reps · 100 kg", "2 · Working · 8 reps · 100 lb"]);
    await openRow(user, 2);
    expect(within(screen.getByRole("group", { name: "Set 2" })).getByText("lb")).toBeInTheDocument();
    await chooseSegment(user, "Weight unit", "kg");
    expect(summaryButtons().map((b) => b.textContent)).toEqual(["1 · Working · 8 reps · 100 kg", "2 · Working · 8 reps · 100 kg"]);
  });

  it("17.11 AC13 / minor 519 — while mixed, a row with no unit shows the unit it will save in, closed and open", async () => {
    const { user } = setup(<Harness initial={[row("a"), row("b", { weightUnit: "lb" }), row("c", { weightUnit: null })]} fallbackUnit="kg" />);
    expect(summaryButton(3)).toHaveTextContent("3 · Working · 8 reps · 100 kg");
    await openRow(user, 3);
    expect(within(screen.getByRole("group", { name: "Set 3" })).getByText("kg")).toBeInTheDocument();
  });

  it("a row's type is its own Segmented", async () => {
    const { user } = setup(<Harness initial={THREE} />);
    await openRow(user, 2);
    const group = screen.getByRole("group", { name: "Set 2" });
    expect(segmented("Set 2 type", group)).toBeInTheDocument();
    await chooseSegment(user, "Set 2 type", "Drop", group);
    expect(summaryButton(2)).toHaveAccessibleName("2 · Drop · 8 reps · 100 kg");
  });

  it("a row error sits beside its field when the row is open", async () => {
    const { user } = setup(<Harness initial={THREE} errors={new Map([["b", { reps: "Enter reps like 8 or 8-10" }]])} />);
    await openRow(user, 2);
    expect(screen.getByLabelText("Set 2 reps")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Set 2 reps")).toHaveAccessibleDescription(/Enter reps like 8 or 8-10/);
  });
});

describe("17.11 AC14 — the edge Move buttons say why in words", () => {
  it("Move up on the first row reads 'First set'; Move down on the last reads 'Last set'", async () => {
    const { user } = setup(<Harness initial={THREE} />);
    await openRow(user, 1);
    const up = screen.getByRole("button", { name: "Move up, set 1" });
    expect(up).toBeDisabled();
    expect(up).toHaveAccessibleDescription("First set");
    expect(screen.getByRole("button", { name: "Move down, set 1" })).not.toHaveAccessibleDescription();
    await openRow(user, 3);
    const down = screen.getByRole("button", { name: "Move down, set 3" });
    expect(down).toBeDisabled();
    expect(down).toHaveAccessibleDescription("Last set");
    expect(screen.getByRole("button", { name: "Move up, set 3" })).not.toHaveAccessibleDescription();
  });

  it("minor 523 — the note is in the action row, right after its button", async () => {
    const { user } = setup(<Harness initial={THREE} />);
    await openRow(user, 1);
    const up = screen.getByRole("button", { name: "Move up, set 1" });
    const note = screen.getByText("First set");
    expect(note.parentElement).toBe(up.parentElement);
    expect(up.nextElementSibling).toBe(note);
    const actions = screen.getByRole("button", { name: "Remove, set 1" }).parentElement!;
    expect(up.parentElement!.parentElement).toBe(actions);
  });

  it("minor 523 — the only row keeps each note beside its own button", async () => {
    const { user } = setup(<Harness initial={[row("a")]} />);
    if (!screen.queryByRole("group", { name: "Set 1" })) await openRow(user, 1);
    const up = screen.getByRole("button", { name: "Move up, set 1" });
    const down = screen.getByRole("button", { name: "Move down, set 1" });
    expect(up.nextElementSibling).toBe(screen.getByText("First set"));
    expect(down.nextElementSibling).toBe(screen.getByText("Last set"));
    expect(up.parentElement).not.toBe(down.parentElement);
  });

  it("a middle row has no edge reason", async () => {
    const { user } = setup(<Harness initial={THREE} />);
    await openRow(user, 2);
    expect(screen.queryByText("First set")).toBeNull();
    expect(screen.queryByText("Last set")).toBeNull();
  });
});

describe("17.11 AC20 — accessible names", () => {
  it("an open row is a group named 'Set k'; its fields and buttons keep their names", async () => {
    const { user } = setup(<Harness initial={THREE} />);
    await openRow(user, 2);
    const group = within(screen.getByRole("group", { name: "Set 2" }));
    expect(segmented("Set 2 type", screen.getByRole("group", { name: "Set 2" }))).toBeInTheDocument();
    expect(group.getByLabelText("Set 2 reps")).toBeInTheDocument();
    expect(group.getByLabelText("Set 2 weight")).toBeInTheDocument();
    for (const name of ["Move up, set 2", "Move down, set 2", "Remove, set 2"]) expect(group.getByRole("button", { name })).toBeInTheDocument();
  });
});
