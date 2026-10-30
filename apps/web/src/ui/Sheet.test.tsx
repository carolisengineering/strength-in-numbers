import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

describe("DM-12 — a sheet that is not dismissible (a save in flight)", () => {
  it("Close and a cancel event do nothing; Close says it is unavailable", async () => {
    const onClose = vi.fn();
    render(<Sheet open title="Details" onClose={onClose} dismissible={false} />);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(close);
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a close the browser made anyway still reaches the parent, so its open state stays in step (AC32)", () => {
    const onClose = vi.fn();
    render(<Sheet open title="Details" onClose={onClose} dismissible={false} />);
    fireEvent(screen.getByRole("dialog"), new Event("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismissible by default: Close has no aria-disabled", () => {
    render(<Sheet open title="Details" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Close" })).not.toHaveAttribute("aria-disabled");
  });
});

// Vitest loads no CSS, so the rule text is the contract (as AppShell's AC2 tests do).
describe("#206 — a sheet is the visible rectangle while a keyboard is up", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Sheet.module.css"), "utf8");
  const escaped = ':global(:root[data-keyboard="open"]) .sheet'.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  it("takes --app-top and --app-height in place of the full screen", () => {
    expect(rule).toMatch(/top:\s*var\(--app-top\)/);
    expect(rule).toMatch(/bottom:\s*auto/);
    expect(rule).toMatch(/margin-block:\s*0/);
    expect(rule).toMatch(/(^|[^-])height:\s*var\(--app-height\)/);
    expect(rule).toMatch(/max-height:\s*var\(--app-height\)/);
  });
});
