import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ResumingSession } from "./ResumingSession";

function renderResuming() {
  return render(
    <MemoryRouter>
      <ResumingSession />
    </MemoryRouter>,
  );
}

describe("17.3 AC14 — ResumingSession is the same title card with the same words", () => {
  it("shows the name, the status sentence and the Go to sign in link", () => {
    renderResuming();
    const main = screen.getByTestId("resuming-session");

    expect(within(main).getByRole("heading", { level: 1 })).toHaveAccessibleName("Strength in Numbers");
    expect(within(main).getByRole("status")).toHaveTextContent(/^Resuming your session…$/);
    expect(within(main).getByRole("link", { name: /^go to sign in$/i })).toHaveAttribute("href", "/?signin");
  });
});

describe("17.3 AC15 — only the status sentence is a live region", () => {
  it("puts role status on the sentence, not on main, and has no other live region", () => {
    renderResuming();
    const main = screen.getByTestId("resuming-session");

    expect(main.tagName).toBe("MAIN");
    expect(main).not.toHaveAttribute("role");
    expect(main).not.toHaveAttribute("aria-live");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").tagName).toBe("P");
    expect(main.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(screen.getByRole("main")).toBe(main);
  });
});

describe("17.3 AC16 / AC28 — the escape link is the only tab stop", () => {
  it("is a real link, not a button, and Tab lands on it", async () => {
    renderResuming();
    const link = screen.getByRole("link", { name: /go to sign in/i });

    expect(link.tagName).toBe("A");
    expect(screen.queryByRole("button")).toBeNull();

    await userEvent.tab();
    expect(document.activeElement).toBe(link);
    await userEvent.tab();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("17.3 AC11 — stable test hook", () => {
  it("keeps the resuming-session test id on the main", () => {
    renderResuming();
    expect(screen.getByTestId("resuming-session")).toBe(screen.getByRole("main"));
  });
});
