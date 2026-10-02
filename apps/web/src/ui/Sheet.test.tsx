import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Sheet } from "./Sheet";

describe("AC32 — <Sheet> forwards a native close", () => {
  it("calls onClose once when the dialog closes itself while the parent still thinks it is open", () => {
    const onClose = vi.fn();
    render(<Sheet open title="Edit set" onClose={onClose} />);

    fireEvent(screen.getByRole("dialog"), new Event("close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when the parent closed it by flipping open to false", () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<Sheet open title="Edit set" onClose={onClose} />);

    rerender(<Sheet open={false} title="Edit set" onClose={onClose} />);
    // A real browser fires `close` asynchronously after dialog.close(); emulate it.
    fireEvent(container.querySelector("dialog")!, new Event("close"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("a re-opened sheet forwards a later native close again", () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<Sheet open title="Edit set" onClose={onClose} />);
    rerender(<Sheet open={false} title="Edit set" onClose={onClose} />);
    rerender(<Sheet open title="Edit set" onClose={onClose} />);

    fireEvent(container.querySelector("dialog")!, new Event("close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("AC24 — <Sheet> is a modal dialog", () => {
  it("opens a dialog labelled by its title and renders its children", () => {
    render(
      <Sheet open title="Add exercise" onClose={() => undefined}>
        <p>sheet body</p>
      </Sheet>,
    );

    const dialog = screen.getByRole("dialog", { name: "Add exercise" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("sheet body")).toBeInTheDocument();
  });

  it("is closed, with no content, while open is false", () => {
    const { container } = render(
      <Sheet open={false} title="Add exercise" onClose={() => undefined}>
        <p>sheet body</p>
      </Sheet>,
    );

    expect(container.querySelector("dialog")).not.toHaveAttribute("open");
    expect(screen.queryByText("sheet body")).not.toBeInTheDocument();
    expect(screen.queryByText("Add exercise")).not.toBeInTheDocument();
  });

  it("closes the dialog element when open goes from true to false", () => {
    const { container, rerender } = render(
      <Sheet open title="Add exercise" onClose={() => undefined} />,
    );
    expect(container.querySelector("dialog")).toHaveAttribute("open");

    rerender(<Sheet open={false} title="Add exercise" onClose={() => undefined} />);

    expect(container.querySelector("dialog")).not.toHaveAttribute("open");
  });

  it("the Close button calls onClose and leaves the dialog open", async () => {
    const onClose = vi.fn();
    render(<Sheet open title="Add exercise" onClose={onClose} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
  });

  it("a cancel event (Escape, Android back) calls onClose and is prevented", () => {
    const onClose = vi.fn();
    render(<Sheet open title="Add exercise" onClose={onClose} />);
    const cancel = new Event("cancel", { cancelable: true });

    fireEvent(screen.getByRole("dialog"), cancel);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cancel.defaultPrevented).toBe(true);
  });

  it("puts the Close button before the body in DOM order", () => {
    render(
      <Sheet open title="Add exercise" onClose={() => undefined}>
        <input aria-label="first field" />
      </Sheet>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    const field = screen.getByLabelText("first field");

    expect(close.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
