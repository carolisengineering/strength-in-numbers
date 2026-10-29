import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionSection } from "./SessionSectionHeading";

describe("10.6 AC1 / AC2 — SessionSection", () => {
  it("with onEdit: an Edit button named for the section, inside the region after the h2, that calls it", async () => {
    const onEdit = vi.fn();
    render(
      <SessionSection heading="Warm-up" notes="Easy" onEdit={onEdit}>
        {[]}
      </SessionSection>,
    );
    const region = screen.getByRole("region", { name: "Warm-up" });
    const button = within(region).getByRole("button", { name: "Edit section Warm-up" });
    expect(button).toHaveTextContent(/^Edit$/);
    const h2 = within(region).getByRole("heading", { level: 2, name: "Warm-up" });
    expect(h2.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(button);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("the editRef receives the Edit button", () => {
    const editRef = vi.fn();
    render(
      <SessionSection heading="Warm-up" notes={null} onEdit={() => {}} editRef={editRef}>
        {[]}
      </SessionSection>,
    );
    expect(editRef).toHaveBeenCalledWith(screen.getByRole("button", { name: "Edit section Warm-up" }));
  });

  it("without onEdit: no button", () => {
    render(
      <SessionSection heading="Warm-up" notes={null}>
        {[]}
      </SessionSection>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("with emptyText and empty: the muted line; with cards: none", () => {
    const { rerender } = render(
      <SessionSection heading="Cooldown" notes={null} emptyText="No exercises yet." empty>
        {[]}
      </SessionSection>,
    );
    expect(screen.getByText("No exercises yet.")).toBeInTheDocument();
    rerender(
      <SessionSection heading="Cooldown" notes={null} emptyText="No exercises yet." empty={false}>
        {[<div key="a">card</div>]}
      </SessionSection>,
    );
    expect(screen.queryByText("No exercises yet.")).toBeNull();
  });
});

describe("Minor 64 — empty is explicit", () => {
  const Nothing = () => null;
  it("empty with a child that renders nothing: the muted line shows", () => {
    render(
      <SessionSection heading="Cooldown" notes={null} emptyText="No exercises yet." empty>
        <Nothing />
      </SessionSection>,
    );
    expect(screen.getByText("No exercises yet.")).toBeInTheDocument();
  });
  it("empty={false} with an empty children array: no muted line", () => {
    render(
      <SessionSection heading="Cooldown" notes={null} emptyText="No exercises yet." empty={false}>
        {[]}
      </SessionSection>,
    );
    expect(screen.queryByText("No exercises yet.")).toBeNull();
  });
});
