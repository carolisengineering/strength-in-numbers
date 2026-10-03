import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <ConfirmDialog
      open
      title="Finish workout?"
      confirmLabel="Finish"
      cancelLabel="Keep logging"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    >
      <p>4 exercises · 11 sets.</p>
    </ConfirmDialog>,
  );
  return { onConfirm, onCancel, ...view };
}

describe("AC31 — <ConfirmDialog>", () => {
  it("is a modal dialog labelled by its title, with its body and both buttons", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Finish workout?" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("4 exercises · 11 sets.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep logging" })).toBeInTheDocument();
  });

  it("Cancel comes before Confirm, so Confirm is the thumb-zone-side action", () => {
    renderDialog();
    const [first, second] = screen.getAllByRole("button");
    expect(first).toHaveTextContent("Keep logging");
    expect(second).toHaveTextContent("Finish");
  });

  it("defaults the cancel label to Cancel", () => {
    renderDialog({ cancelLabel: undefined });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("Confirm and Cancel call their handlers", async () => {
    const { onConfirm, onCancel } = renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(screen.getByRole("button", { name: "Keep logging" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a cancel event (Escape / Android back) calls onCancel and does not close the dialog itself", () => {
    const { onCancel } = renderDialog();
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(cancel.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
  });

  it("a native close while the parent still thinks it is open calls onCancel once (final review I2)", () => {
    // A second Escape / Android back without user activation closes the dialog natively and fires a
    // non-cancelable `cancel`; without this the parent's `open` stays true and the next tap does nothing.
    const { onCancel } = renderDialog();

    fireEvent(screen.getByRole("dialog"), new Event("close"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a close caused by the parent flipping open to false is not reported back", () => {
    const { container, rerender, onConfirm, onCancel } = renderDialog();

    rerender(
      <ConfirmDialog open={false} title="Finish workout?" confirmLabel="Finish" onConfirm={onConfirm} onCancel={onCancel}>
        <p>body</p>
      </ConfirmDialog>,
    );
    fireEvent(container.querySelector("dialog")!, new Event("close")); // a browser fires this after dialog.close()

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("busy disables both buttons and sets aria-busy on the dialog", () => {
    renderDialog({ busy: true });
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep logging" })).toBeDisabled();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  });

  it("the danger variant styles the confirm button as danger", () => {
    renderDialog({ variant: "danger", confirmLabel: "Discard" });
    expect(screen.getByRole("button", { name: "Discard" }).className).toMatch(/danger/);
  });

  it("is closed, with no content, while open is false, and closes when open flips to false", () => {
    const { container, rerender, onConfirm, onCancel } = renderDialog();
    rerender(
      <ConfirmDialog open={false} title="Finish workout?" confirmLabel="Finish" onConfirm={onConfirm} onCancel={onCancel}>
        <p>4 exercises · 11 sets.</p>
      </ConfirmDialog>,
    );
    expect(container.querySelector("dialog")).not.toHaveAttribute("open");
    expect(screen.queryByText("4 exercises · 11 sets.")).not.toBeInTheDocument();
  });
});
