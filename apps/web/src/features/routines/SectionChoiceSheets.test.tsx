import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { sheetBody, sheetRow } from "../../test/sheetHelpers";
import { AddSectionSheet } from "./AddSectionSheet";
import { MoveToSectionSheet } from "./MoveToSectionSheet";
import { SECTION_NAME_REQUIRED } from "./messages";

const rowLabels = () => sheetRow().getAllByRole("button").map((b) => b.textContent);

function renderMove() {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(
    <MoveToSectionSheet
      open
      title="Move Bench Press"
      current={null}
      sections={[{ key: "s1", name: "Main" }]}
      onChoose={onChoose}
      onClose={onClose}
    />,
  );
  return { onChoose, onClose, user: userEvent.setup() };
}

function renderAdd() {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<AddSectionSheet open onAdd={onAdd} onClose={onClose} />);
  return { onAdd, onClose, user: userEvent.setup() };
}

describe("17.10 AC15 — Move to section has a Cancel-only row", () => {
  it("the row holds only Cancel, and Cancel calls onClose", async () => {
    const { user, onClose, onChoose } = renderMove();
    expect(rowLabels()).toEqual(["Cancel"]);
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("choosing a section in the body still calls onChoose", async () => {
    const { user, onChoose } = renderMove();
    await user.click(within(sheetBody()).getByRole("button", { name: "Main" }));
    expect(onChoose).toHaveBeenCalledWith("s1");
  });
});

describe("17.10 AC15 — Add section's row is Cancel then Add", () => {
  it("the row reads Cancel, Add", () => {
    renderAdd();
    expect(rowLabels()).toEqual(["Cancel", "Add"]);
  });

  it("Add with a blank name shows the field's error and keeps the sheet open", async () => {
    const { user, onAdd, onClose } = renderAdd();
    await user.click(sheetRow().getByRole("button", { name: "Add" }));
    expect(within(sheetBody()).getByText(SECTION_NAME_REQUIRED)).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Add section" })).toBeInTheDocument();
  });

  it("Add with a typed name adds it", async () => {
    const { user, onAdd } = renderAdd();
    await user.type(within(sheetBody()).getByLabelText("Name"), "Conditioning");
    await user.click(sheetRow().getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("Conditioning");
  });

  it("a starter in the body still adds at once", async () => {
    const { user, onAdd } = renderAdd();
    await user.click(within(sheetBody()).getByRole("button", { name: "Finisher" }));
    expect(onAdd).toHaveBeenCalledWith("Finisher");
  });
});

describe("17.10 AC7 — the section choice sheets keep no dismiss or primary in the body", () => {
  it("Move to section's body has no Cancel", () => {
    renderMove();
    expect(within(sheetBody()).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("Add section's body has no Add or Cancel", () => {
    renderAdd();
    expect(within(sheetBody()).queryByRole("button", { name: "Add" })).toBeNull();
    expect(within(sheetBody()).queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
