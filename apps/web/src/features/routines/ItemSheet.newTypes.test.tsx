import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Modality } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { ItemSheet } from "./ItemSheet";
import type { DraftItem } from "./routineDraft";

const item = (o: Partial<DraftItem> = {}): DraftItem => ({
  key: "k", exerciseId: exerciseId(1), targetSets: 3, targetRepsLow: null, targetRepsHigh: null, targetRpe: null,
  restSeconds: null, notes: null, supersetGroup: null, weight: null, weightUnit: null, plan: null, sectionKey: null, ...o,
});
function setup(modality: Modality) {
  render(<ItemSheet open title="X" item={item()} onDone={vi.fn()} onPlanned={vi.fn()} onClose={vi.fn()} modality={modality} defaultUnit="kg" />);
  return userEvent.setup();
}

describe("18.1 AC22 — item sheet", () => {
  it("calories: Sets, Rest and Notes only — no Reps, no Weight, no unit toggle", () => {
    setup("calories");
    for (const label of ["Sets", "Rest", "Notes"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.queryByLabelText("Reps")).toBeNull();
    expect(screen.queryByLabelText("Weight")).toBeNull();
    expect(screen.queryByRole("group", { name: "Weight unit" })).toBeNull();
  });
  it.each(["weight_distance", "weight_duration"] as const)("%s: Sets, Weight with the unit toggle, Rest, Notes — no Reps", (modality) => {
    setup(modality);
    for (const label of ["Sets", "Weight", "Rest", "Notes"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Weight unit" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Reps")).toBeNull();
  });
  it("plan mode: calories rows show only Type; weighted rows show Type and Weight", async () => {
    const user = setup("calories");
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(screen.getByLabelText("Set 1 type")).toBeInTheDocument();
    expect(screen.queryByLabelText("Set 1 reps")).toBeNull();
    expect(screen.queryByLabelText("Set 1 weight")).toBeNull();
  });
  it.each(["weight_distance", "weight_duration"] as const)("plan mode, %s: Type and Weight, no reps", async (modality) => {
    const user = setup(modality);
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(screen.getByLabelText("Set 1 type")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 1 weight")).toBeInTheDocument();
    expect(screen.queryByLabelText("Set 1 reps")).toBeNull();
  });
});
