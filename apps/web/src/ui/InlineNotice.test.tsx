import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineNotice } from "./InlineNotice";

describe("<InlineNotice> (Spec 06.1 D12 — in-shell errors without a nested landmark)", () => {
  it("an error is an alert that shows its request id and a retry action", async () => {
    const onAction = vi.fn();
    render(
      <InlineNotice tone="error" requestId="req-123" actionLabel="Try again" onAction={onAction}>
        Couldn't log set — try again
      </InlineNotice>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't log set — try again");
    expect(screen.getByText(/req-123/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("a warning is an alert too", () => {
    render(<InlineNotice tone="warning">2 working sets are missing data.</InlineNotice>);
    expect(screen.getByRole("alert")).toHaveTextContent("2 working sets are missing data.");
  });

  it("info is a polite status, with no action and no request id unless given", () => {
    render(<InlineNotice>You already had a workout in progress — resumed it.</InlineNotice>);
    expect(screen.getByRole("status")).toHaveTextContent("resumed it");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Request ID/)).not.toBeInTheDocument();
  });

  it("renders no landmark of its own (it sits inside AppShell's <main>)", () => {
    const { container } = render(<InlineNotice tone="error">x</InlineNotice>);
    expect(container.querySelector("main, section, aside, nav, header")).toBeNull();
  });
});
