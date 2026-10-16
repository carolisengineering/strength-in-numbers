import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LogoutGuardDialog } from "./useLogoutGuard";

describe("06.5 AC20 — the dialog follows the guard's phase", () => {
  it("syncing: live status text, disabled Sign out anyway, enabled Cancel", () => {
    render(<LogoutGuardDialog state={{ phase: "syncing", unsaved: { sets: 2, notes: 0 } }} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Saving your sets…" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Saving your sets…");
    // Review fix: the page-level Spinner is min-height 100dvh and would push Cancel off a phone screen.
    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out anyway" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("warning: the count message, Stay focused, Sign out anyway enabled", () => {
    render(<LogoutGuardDialog state={{ phase: "warning", unsaved: { sets: 3, notes: 0 } }} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText("3 sets haven't saved. If you sign out now they'll be lost.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stay" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Sign out anyway" })).toBeEnabled();
  });

  it("idle: nothing is rendered open", () => {
    render(<LogoutGuardDialog state={{ phase: "idle", unsaved: { sets: 0, notes: 0 } }} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
