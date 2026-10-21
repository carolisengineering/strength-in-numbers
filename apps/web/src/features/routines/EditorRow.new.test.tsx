import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EditorRow, type EditorRowProps } from "./EditorRow";

const props = (overrides: Partial<EditorRowProps>): EditorRowProps => ({
  name: "Hand Release Pushups",
  line: "3 sets",
  notes: null,
  position: "none",
  accessibleName: "Hand Release Pushups (New), 3 sets",
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

describe("10.4 AC30 — a pending exercise's row carries a New tag", () => {
  it("isNew shows the text New inside the row's main button", () => {
    render(<EditorRow {...props({ isNew: true })} />);
    expect(within(screen.getByRole("button", { name: /^Hand Release Pushups \(New\)/ })).getByText("New")).toBeInTheDocument();
  });
  it("absent by default", () => {
    render(<EditorRow {...props({ accessibleName: "Hand Release Pushups, 3 sets" })} />);
    expect(screen.queryByText("New")).toBeNull();
  });
});
