import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineNotice } from "./InlineNotice";

describe("06.4 AC8 — <InlineNotice> offers Dismiss only when given onDismiss", () => {
  it("renders a Dismiss button that calls onDismiss", async () => {
    const onDismiss = vi.fn();
    render(<InlineNotice onDismiss={onDismiss}>You already had a workout in progress — resumed it.</InlineNotice>);

    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders no Dismiss without onDismiss", () => {
    render(<InlineNotice>Couldn't refresh your workout — showing the last copy we have.</InlineNotice>);
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("an action and Dismiss can sit side by side", () => {
    render(
      <InlineNotice tone="error" actionLabel="Try again" onAction={() => {}} onDismiss={() => {}}>
        Couldn't finish — try again
      </InlineNotice>,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});
