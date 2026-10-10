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
    await user.selectOptions(screen.getByLabelText("RPE"), "8.5");
    await user.type(screen.getByLabelText("Rest"), "1:30");
    await user.type(screen.getByLabelText("Notes"), " slow eccentric ");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith(
      { targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetRpe: 8.5, restSeconds: 90 },
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
    expect(screen.getByLabelText("RPE")).toHaveValue("9");
    expect(screen.getByLabelText("Rest")).toHaveValue("2:05");
    expect(screen.getByLabelText("Notes")).toHaveValue("belt");
  });

  it("RPE offers No target and 6 … 10 in halves", () => {
    setup();
    const options = Array.from((screen.getByLabelText("RPE") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["No target", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10"]);
  });

  it("Close discards edits", async () => {
    const { onDone, onClose, user } = setup();
    await user.type(screen.getByLabelText("Sets"), "3");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
