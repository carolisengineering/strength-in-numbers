import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Modality, WeightUnit } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { ItemSheet } from "./ItemSheet";
import type { DraftItem } from "./routineDraft";
import { WEIGHT_MESSAGE } from "./targetFormat";
import { WEIGHT_NEEDS_SETS } from "./validateDraft";

const item = (o: Partial<DraftItem> = {}): DraftItem => ({
  key: "k", exerciseId: exerciseId(1), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null,
  restSeconds: null, notes: null, supersetGroup: null, weight: null, weightUnit: null, plan: null, sectionKey: null, ...o,
});

function setup(initial = item(), extra: { modality?: Modality | null; defaultUnit?: WeightUnit } = {}) {
  const onDone = vi.fn();
  const onPlanned = vi.fn();
  const onClose = vi.fn();
  render(<ItemSheet open title="Bench Press" item={initial} onDone={onDone} onPlanned={onPlanned} onClose={onClose} {...extra} />);
  return { onDone, onPlanned, onClose, user: userEvent.setup() };
}
const unitButton = (name: "kg" | "lb") => screen.getByRole("button", { name });

describe("10.2 AC10 — the quick line gains Weight", () => {
  it("shows Weight and a kg / lb toggle beside Sets and Reps; the toggle defaults to the profile unit", () => {
    setup(item(), { modality: "weight_reps", defaultUnit: "lb" });
    expect(screen.getByLabelText("Weight")).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByRole("group", { name: "Weight unit" })).toBeInTheDocument();
    expect(unitButton("lb")).toHaveAttribute("aria-pressed", "true");
    expect(unitButton("kg")).toHaveAttribute("aria-pressed", "false");
  });

  it("a stored unit wins over the profile default; the stored weight is shown", () => {
    setup(item({ targetSets: 3, weight: 62.5, weightUnit: "lb" }), { modality: "weight_reps", defaultUnit: "kg" });
    expect(screen.getByLabelText("Weight")).toHaveValue("62.5");
    expect(unitButton("lb")).toHaveAttribute("aria-pressed", "true");
  });

  it("'4 × 6–8 @ 100 kg' typed on the quick line is committed as quick-mode weight plus the five targets", async () => {
    const { onDone, onPlanned, user } = setup(item(), { modality: "weight_reps", defaultUnit: "kg" });
    await user.type(screen.getByLabelText("Sets"), "4");
    await user.type(screen.getByLabelText("Reps"), "6-8");
    await user.type(screen.getByLabelText("Weight"), "100");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned).toHaveBeenCalledWith({ mode: "quick", weight: 100, weightUnit: "kg" });
    expect(onDone).toHaveBeenCalledWith({ targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, targetRpe: null, restSeconds: null }, null);
  });

  it("the toggle changes the unit that travels with the weight", async () => {
    const { onPlanned, user } = setup(item({ targetSets: 2 }), { modality: "weight_reps", defaultUnit: "kg" });
    await user.type(screen.getByLabelText("Weight"), "225");
    await user.click(unitButton("lb"));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned).toHaveBeenCalledWith({ mode: "quick", weight: 225, weightUnit: "lb" });
  });

  it("a blank weight carries no unit, whatever the toggle shows", async () => {
    const { onPlanned, user } = setup(item({ targetSets: 2 }), { modality: "weight_reps", defaultUnit: "lb" });
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned).toHaveBeenCalledWith({ mode: "quick", weight: null, weightUnit: null });
  });

  it("an invalid weight keeps the sheet open with the static message beside the field", async () => {
    const { onDone, user } = setup(item({ targetSets: 2 }), { modality: "weight_reps" });
    await user.type(screen.getByLabelText("Weight"), "abc");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Weight")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(WEIGHT_MESSAGE)).toBeInTheDocument();
  });

  it("a weight with a blank Sets field asks for the set count (P7)", async () => {
    const { onDone, user } = setup(item(), { modality: "weight_reps" });
    await user.type(screen.getByLabelText("Weight"), "100");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Weight")).toHaveAccessibleDescription(WEIGHT_NEEDS_SETS);
  });

  it("Close discards a typed weight", async () => {
    const { onDone, onPlanned, onClose, user } = setup(item({ targetSets: 2 }), { modality: "weight_reps" });
    await user.type(screen.getByLabelText("Weight"), "100");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onPlanned).not.toHaveBeenCalled();
  });

  it("server messages are shown beside the fields when the sheet opens", () => {
    render(
      <ItemSheet open title="Bench" item={item({ targetSets: 2 })} modality="weight_reps" fieldMessages={{ weight: "Check the weight", reps: "Check the reps" }} onDone={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText("Weight")).toHaveAccessibleDescription("Check the weight");
    expect(screen.getByLabelText("Reps")).toHaveAccessibleDescription(/Check the reps/);
  });
});

describe("10.2 AC11 — fields gated by exercise", () => {
  const SHOWN: [Modality | null, string[], string[]][] = [
    ["weight_reps", ["Sets", "Reps", "Weight"], []],
    ["weighted_bodyweight", ["Sets", "Reps", "Weight"], []],
    ["bodyweight_reps", ["Sets", "Reps"], ["Weight"]],
    ["duration", ["Sets"], ["Reps", "Weight"]],
    ["distance_duration", ["Sets"], ["Reps", "Weight"]],
    [null, ["Sets", "Reps", "Weight"], []], // the catalog has not synced: show everything
  ];
  it.each(SHOWN)("%s", (modality, shown, hidden) => {
    setup(item(), { modality });
    for (const label of shown) expect(screen.getByLabelText(label)).toBeInTheDocument();
    for (const label of hidden) expect(screen.queryByLabelText(label)).toBeNull();
    if (hidden.includes("Weight")) expect(screen.queryByRole("group", { name: "Weight unit" })).toBeNull();
    for (const label of ["RPE", "Rest", "Notes"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
  });
});

describe("10.2 AC18 — stored values the exercise cannot carry are cleaned by a deliberate Done", () => {
  it("a timed exercise with stored reps shows no Reps field; Done writes null reps (a real change)", async () => {
    const { onDone, onPlanned, user } = setup(item({ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10 }), { modality: "duration" });
    expect(screen.queryByLabelText("Reps")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith({ targetSets: 3, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null }, null);
    expect(onPlanned).toHaveBeenCalledWith({ mode: "quick", weight: null, weightUnit: null });
  });
  it("a bodyweight exercise with a stored weight shows no Weight field; Done clears it", async () => {
    const { onPlanned, user } = setup(item({ targetSets: 3, weight: 20, weightUnit: "kg" }), { modality: "bodyweight_reps" });
    expect(screen.queryByLabelText("Weight")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onPlanned).toHaveBeenCalledWith({ mode: "quick", weight: null, weightUnit: null });
  });
});
