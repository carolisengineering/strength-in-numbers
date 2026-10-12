import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Modality, WeightUnit } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { ItemSheet } from "./ItemSheet";
import type { DraftItem, DraftSet } from "./routineDraft";

const item = (o: Partial<DraftItem> = {}): DraftItem => ({
  key: "k", exerciseId: exerciseId(1), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null,
  restSeconds: null, notes: null, supersetGroup: null, weight: null, weightUnit: null, plan: null, ...o,
});
const set = (key: string, o: Partial<DraftSet> = {}): DraftSet => ({ key, setType: "working", repsLow: 8, repsHigh: 8, weight: 100, weightUnit: "kg", ...o });
const RAMP = [set("r1", { setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60 }), set("r2", { weight: 80 }), set("r3", { repsLow: 6, repsHigh: 6 })];

function setup(initial = item(), extra: { modality?: Modality | null; defaultUnit?: WeightUnit } = {}) {
  const onDone = vi.fn();
  const onPlanned = vi.fn();
  render(<ItemSheet open title="Bench Press" item={initial} onDone={onDone} onPlanned={onPlanned} onClose={vi.fn()} modality="weight_reps" {...extra} />);
  return { onDone, onPlanned, user: userEvent.setup() };
}
const rowsCount = () => screen.queryAllByRole("group", { name: /^Set \d+$/ }).length;

describe("10.2 AC12 — Plan each set", () => {
  it("the quick line always offers it; it replaces Sets / Reps / Weight with rows and keeps RPE, Rest, Notes", async () => {
    const { user } = setup(item({ targetSets: 3, targetRepsLow: 6, targetRepsHigh: 8, weight: 100, weightUnit: "kg" }));
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(rowsCount()).toBe(3);
    expect(screen.getByLabelText("Set 1 reps")).toHaveValue("6-8");
    expect(screen.getByLabelText("Set 3 weight")).toHaveValue("100");
    expect(screen.queryByLabelText("Sets")).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan each set" })).toBeNull();
    for (const label of ["RPE", "Rest", "Notes"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
  });
  it("a blank Sets field makes one row (D11)", async () => {
    const { user } = setup(item());
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(rowsCount()).toBe(1);
  });
  it("an invalid Sets field blocks entering plan mode with the Sets message", async () => {
    const { user } = setup(item());
    await user.type(screen.getByLabelText("Sets"), "abc");
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(rowsCount()).toBe(0);
    expect(screen.getByLabelText("Sets")).toHaveAttribute("aria-invalid", "true");
  });
  it("is offered for a timed exercise too: rows show the type only", async () => {
    const { user } = setup(item({ targetSets: 2 }), { modality: "duration" });
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(rowsCount()).toBe(2);
    expect(screen.queryByLabelText("Set 1 reps")).toBeNull();
    expect(screen.queryByLabelText("Set 1 weight")).toBeNull();
  });
});

describe("10.2 AC14 — Back to the quick line only when lossless", () => {
  it("uniform rows offer it; taking it restores the quick fields and what would be saved is unchanged", async () => {
    const { onDone, onPlanned, user } = setup(item({ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 8, weight: 100, weightUnit: "kg" }));
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    await user.click(screen.getByRole("button", { name: "Back to the quick line" }));
    expect(screen.getByLabelText("Sets")).toHaveValue("3");
    expect(screen.getByLabelText("Reps")).toHaveValue("8");
    expect(screen.getByLabelText("Weight")).toHaveValue("100");
    expect(rowsCount()).toBe(0);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned).toHaveBeenCalledWith({ mode: "quick", weight: 100, weightUnit: "kg" });
    expect(onDone).toHaveBeenCalledWith({ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 8, targetRpe: null, restSeconds: null }, null);
  });
  it.each([
    ["a ramp", RAMP],
    ["a warm-up", [set("a", { setType: "warmup" }), set("b")]],
    ["different reps", [set("a", { repsLow: 5, repsHigh: 5 }), set("b")]],
  ])("%s: the button is absent and a line says why", (_name, plan) => {
    setup(item({ plan }));
    expect(screen.queryByRole("button", { name: "Back to the quick line" })).toBeNull();
    expect(screen.getByText("Sets differ, so they can't be shown as one line")).toBeInTheDocument();
  });
  it("editing a row so the rows differ withdraws the button; making them equal again offers it", async () => {
    const { user } = setup(item({ plan: [set("a"), set("b")] }));
    expect(screen.getByRole("button", { name: "Back to the quick line" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Set 2 weight"), "5");
    expect(screen.queryByRole("button", { name: "Back to the quick line" })).toBeNull();
    await user.clear(screen.getByLabelText("Set 2 weight"));
    await user.type(screen.getByLabelText("Set 2 weight"), "100");
    expect(screen.getByRole("button", { name: "Back to the quick line" })).toBeInTheDocument();
  });
});

describe("10.2 AC16 — Done in plan mode", () => {
  it("commits the parsed rows and the derived targets; keys are kept", async () => {
    const { onDone, onPlanned, user } = setup(item({ plan: RAMP, targetSets: 3, targetRepsLow: 6, targetRepsHigh: 10, targetRpe: 8, restSeconds: 150 }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned).toHaveBeenCalledWith({ mode: "rows", rows: RAMP });
    expect(onDone).toHaveBeenCalledWith({ targetSets: 3, targetRepsLow: 6, targetRepsHigh: 10, targetRpe: 8, restSeconds: 150 }, null);
  });
  it("an untouched Done hands back rows equal to the ones it was given (so the reducer sees no change)", async () => {
    const { onPlanned, user } = setup(item({ plan: RAMP }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned.mock.calls[0]![0].rows).toEqual(RAMP);
  });
  it("invalid rows show their messages beside the fields and keep the sheet open; nothing is committed", async () => {
    const { onDone, onPlanned, user } = setup(item({ plan: [set("a"), set("b")] }));
    await user.clear(screen.getByLabelText("Set 2 reps"));
    await user.type(screen.getByLabelText("Set 2 reps"), "9-3");
    await user.clear(screen.getByLabelText("Set 1 weight"));
    await user.type(screen.getByLabelText("Set 1 weight"), "abc");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).not.toHaveBeenCalled();
    expect(onPlanned).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Set 2 reps")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Set 1 weight")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Set 1 reps")).not.toHaveAttribute("aria-invalid");
  });
  it("server messages for a row are shown beside it when the sheet opens", () => {
    render(
      <ItemSheet open title="Bench" item={item({ plan: [set("a"), set("b")] })} modality="weight_reps" rowMessages={new Map([["b", { weight: "Check the weight" }]])} onDone={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText("Set 2 weight")).toHaveAccessibleDescription("Check the weight");
  });
  it("adding, removing and moving rows are committed only by Done; Close discards them", async () => {
    const onClose = vi.fn();
    const onPlanned = vi.fn();
    const user = userEvent.setup();
    render(<ItemSheet open title="Bench" item={item({ plan: RAMP })} modality="weight_reps" onPlanned={onPlanned} onDone={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Add set" }));
    expect(rowsCount()).toBe(4);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(onPlanned).not.toHaveBeenCalled();
  });
  it("with rows loaded in different units, neither segment is pressed until one is picked (D3)", async () => {
    const { onPlanned, user } = setup(item({ plan: [set("a"), set("b", { weightUnit: "lb", weight: 225 })] }));
    const group = screen.getByRole("group", { name: "Weight unit" });
    expect(within(group).getByRole("button", { name: "kg" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Mixed units — pick one to use for all sets")).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "lb" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned.mock.calls[0]![0].rows.map((r: DraftSet) => [r.weight, r.weightUnit])).toEqual([[100, "lb"], [225, "lb"]]);
  });
});

describe("10.2 AC13 — a weight typed into a weightless row takes the unit the toggle shows", () => {
  it("rows in lb, profile kg: a weight typed on the weightless row is saved in lb", async () => {
    const { onPlanned, user } = setup(
      item({ plan: [set("a", { weight: null, weightUnit: null }), set("b", { weight: 100, weightUnit: "lb" }), set("c", { weight: 110, weightUnit: "lb" })] }),
      { defaultUnit: "kg" },
    );
    expect(within(screen.getByRole("group", { name: "Weight unit" })).getByRole("button", { name: "lb" })).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByLabelText("Set 1 weight"), "45");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned.mock.calls[0]![0].rows.map((r: DraftSet) => [r.weight, r.weightUnit])).toEqual([[45, "lb"], [100, "lb"], [110, "lb"]]);
  });
});

describe("10.2 AC18 — a plan on an exercise that cannot carry weight shows and sends none", () => {
  it("bodyweight: no weight column; stored weights are cleaned on Done", async () => {
    const { onPlanned, user } = setup(item({ plan: [set("a"), set("b")] }), { modality: "bodyweight_reps" });
    expect(screen.queryByLabelText("Set 1 weight")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned.mock.calls[0]![0].rows.map((r: DraftSet) => r.weight)).toEqual([null, null]);
  });
});
