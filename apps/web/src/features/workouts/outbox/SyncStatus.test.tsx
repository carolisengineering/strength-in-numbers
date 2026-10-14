import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SyncStatus } from "./SyncStatus";

const props = { online: true, onRetry: vi.fn(), onDiscardFailed: vi.fn(), onShowFailed: vi.fn() };

describe("10.3 AC29 — SyncStatus", () => {
  it("renders nothing when nothing is unsaved", () => {
    const { container } = render(<SyncStatus pending={0} failed={0} {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sets only: the exact 06.2 copy, with no note wording", () => {
    render(<SyncStatus pending={2} failed={1} {...props} />);
    expect(screen.getByText("1 set couldn't be saved")).toBeInTheDocument();
    expect(screen.getByText("Saving 2 sets…")).toBeInTheDocument();
    expect(screen.queryByText(/note/)).toBeNull();
  });

  it("offline sets only keeps today's line", () => {
    render(<SyncStatus pending={2} failed={0} {...props} online={false} />);
    expect(screen.getByText("Offline — 2 sets will save when you're back online")).toBeInTheDocument();
  });

  it("notes only still shows the status line with Retry now / Discard", () => {
    const { rerender } = render(<SyncStatus pending={0} failed={0} pendingNotes={1} {...props} />);
    expect(screen.getByText("Saving 1 note…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry now" })).toBeInTheDocument();
    rerender(<SyncStatus pending={0} failed={0} pendingNotes={2} {...props} online={false} />);
    expect(screen.getByText("Offline — 2 notes will save when you're back online")).toBeInTheDocument();
    rerender(<SyncStatus pending={0} failed={0} failedNotes={1} {...props} />);
    expect(screen.getByText("1 note couldn't be saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("sets and notes together share one line each, with one set of buttons", () => {
    render(<SyncStatus pending={2} failed={0} pendingNotes={1} {...props} />);
    expect(screen.getByText("Saving 2 sets and 1 note…")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Retry now" })).toHaveLength(1);
  });
});
