import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { exerciseId } from "../../test/catalogFixtures";
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
