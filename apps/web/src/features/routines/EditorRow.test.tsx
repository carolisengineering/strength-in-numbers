import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorRow, type EditorRowProps } from "./EditorRow";
import { UNAVAILABLE } from "./validateDraft";

const props = (overrides: Partial<EditorRowProps>): EditorRowProps => ({
  name: "Old Row",
  line: "",
  notes: null,
  position: "none",
  accessibleName: "Old Row",
  unavailable: false,
  error: null,
  errorId: "row-k-error",
  isFirst: true,
  isLast: true,
  registerMain: vi.fn(),
  onOpen: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  onRemove: vi.fn(),
  ...overrides,
});

describe("10.0 AC31 — row errors are shown and referenced", () => {
  it("an unavailable row's own marker needs no dangling reference", () => {
    render(<EditorRow {...props({ unavailable: true, error: UNAVAILABLE })} />);
    const main = screen.getByRole("button", { name: "Old Row" });
    const ref = main.getAttribute("aria-describedby");
    if (ref !== null) expect(document.getElementById(ref)).not.toBeNull();
  });

  it("another error on an unavailable row is shown and referenced", () => {
    render(<EditorRow {...props({ unavailable: true, error: "Check the sets — a whole number from 1 to 20" })} />);
    expect(screen.getByRole("button", { name: "Old Row" })).toHaveAccessibleDescription("Check the sets — a whole number from 1 to 20");
  });
});
