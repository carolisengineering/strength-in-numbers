import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { exerciseId } from "../../test/catalogFixtures";
import { sheetBody, sheetRow } from "../../test/sheetHelpers";
import { ItemSheet } from "./ItemSheet";
import type { DraftItem } from "./routineDraft";
import { REST_MESSAGE } from "./targetFormat";

const item = (overrides: Partial<DraftItem> = {}): DraftItem => ({
  key: "k",
  exerciseId: exerciseId(1),
  targetSets: null,
  targetRepsLow: null,
  targetRepsHigh: null,
  targetRpe: null,
  restSeconds: null,
  notes: null,
  supersetGroup: null,
  weight: null,
  weightUnit: null,
  plan: null,
  sectionKey: null,
  ...overrides,
});

function setup(initial = item()) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(<ItemSheet open title="Bench Press" item={initial} onDone={onDone} onClose={onClose} />);
  return { onDone, onClose, user: userEvent.setup() };
}

describe("10.0 AC28 — the item sheet", () => {
  it("parses every field on Done", async () => {
    const { onDone, user } = setup();
    await user.type(screen.getByLabelText("Sets"), "3");
    await user.type(screen.getByLabelText("Reps"), "8-10");
    await user.type(screen.getByLabelText("Rest"), "1:30");
    await user.type(screen.getByLabelText("Notes"), " slow eccentric ");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith(
      { targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetRpe: null, restSeconds: 90 },
      "slow eccentric",
    );
  });

  it("blank means no target; whitespace notes are null (Review Focus 5)", async () => {
    const { onDone, user } = setup();
    await user.type(screen.getByLabelText("Notes"), "   ");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith(
      { targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null },
      null,
    );
  });

  it("invalid fields show their message and keep the sheet open (Review Focus 1: rest '90')", async () => {
    const { onDone, user } = setup();
    await user.type(screen.getByLabelText("Sets"), "0");
    await user.type(screen.getByLabelText("Rest"), "90");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Sets")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(REST_MESSAGE)).toBeInTheDocument();
  });

  it("reopening shows the stored values in input form", () => {
    setup(item({ targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, targetRpe: 9, restSeconds: 125, notes: "belt" }));
    expect(screen.getByLabelText("Sets")).toHaveValue("4");
    expect(screen.getByLabelText("Reps")).toHaveValue("6-8");
    expect(screen.queryByLabelText(/RPE/)).toBeNull();
    expect(screen.getByLabelText("Rest")).toHaveValue("2:05");
    expect(screen.getByLabelText("Notes")).toHaveValue("belt");
  });

  it("17.1 AC1 — the sheet has no RPE control and nothing labeled RPE", () => {
    setup();
    expect(screen.queryByLabelText(/RPE/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /RPE/ })).toBeNull();
    expect(screen.queryByText(/RPE/)).toBeNull();
  });

  it.each([8.5, 6, 10])("17.1 AC5 — a stored targetRpe of %s passes through Done untouched", async (targetRpe) => {
    const { onDone, user } = setup(item({ targetSets: 3, targetRpe }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ targetSets: 3, targetRpe }), null);
  });

  it("Close discards edits", async () => {
    const { onDone, onClose, user } = setup();
    await user.type(screen.getByLabelText("Sets"), "3");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("10.2 AC16 — the item sheet's errors clear when their field changes", () => {
  it("each of Sets, Reps and Rest loses only its own message on an edit; the next Done checks again", async () => {
    const { onDone, user } = setup();
    for (const label of ["Sets", "Reps", "Rest"]) await user.type(screen.getByLabelText(label), "x");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).not.toHaveBeenCalled();
    const invalid = () => ["Sets", "Reps", "Rest"].filter((l) => screen.getByLabelText(l).getAttribute("aria-invalid") === "true");
    expect(invalid()).toEqual(["Sets", "Reps", "Rest"]);
    await user.type(screen.getByLabelText("Reps"), "y");
    expect(invalid()).toEqual(["Sets", "Rest"]);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(invalid()).toEqual(["Sets", "Reps", "Rest"]);
  });

  it("trap 5: editing Sets also clears Weight's 'set a number of sets first'", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("Weight"), "60");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByLabelText("Weight")).toHaveAttribute("aria-invalid", "true");
    await user.type(screen.getByLabelText("Sets"), "3");
    expect(screen.getByLabelText("Weight")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("trap 4: a failed Plan each set doesn't bring back a message the lifter already fixed", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("Sets"), "x");
    await user.type(screen.getByLabelText("Rest"), "x");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByLabelText("Rest")).toHaveAttribute("aria-invalid", "true");
    await user.type(screen.getByLabelText("Rest"), "{Backspace}");
    expect(screen.getByLabelText("Rest")).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(screen.getByLabelText("Sets")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Rest")).not.toHaveAttribute("aria-invalid", "true");
  });
});

describe("17.10 AC14, AC7 — the item sheet uses the action row", () => {
  it("the row holds Cancel then Done; Done submits once; Plan each set stays in the body", async () => {
    const { onDone, user } = setup();
    expect(sheetRow().getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel", "Done"]);
    expect(within(sheetBody()).queryByRole("button", { name: "Done" })).toBeNull();
    expect(within(sheetBody()).getByRole("button", { name: "Plan each set" })).toBeInTheDocument();
    await user.click(sheetRow().getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Cancel calls onClose and commits nothing", async () => {
    const { onDone, onClose, user } = setup();
    await user.type(screen.getByLabelText("Sets"), "3");
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("an invalid Done keeps the sheet open and commits nothing (10.2 AC16)", async () => {
    const { onDone, onClose, user } = setup();
    await user.type(screen.getByLabelText("Sets"), "abc");
    await user.click(sheetRow().getByRole("button", { name: "Done" }));
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
  });

  it("in plan mode, Back to the quick line stays in the body", async () => {
    const { user } = setup(item({ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 8 }));
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(within(sheetBody()).getByRole("button", { name: "Back to the quick line" })).toBeInTheDocument();
    expect(sheetRow().getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel", "Done"]);
  });
});
