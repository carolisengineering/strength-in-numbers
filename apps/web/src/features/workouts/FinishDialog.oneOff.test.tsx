import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { markupOf } from "../../test/markup";
import { EndEarlyDialog } from "./EndEarlyDialog";
import { FinishDialogBody } from "./FinishDialog";
import { KEEP_IN_ROUTINES, oneOffFinishLine } from "./messages";

const HERE = dirname(fileURLToPath(import.meta.url));

const base = {
  stats: { minutes: 42, exercises: 2, sets: 6, volumeKg: 1200 },
  unitPreference: "kg" as const,
  unlogged: { total: 1, planned: 7, byExercise: [{ id: "e1", name: "Bench Press", count: 1 }] },
  note: "Unlogged sets aren't saved.",
};

describe("10.5 AC11 — without the prop the body is unchanged", () => {
  it("renders exactly as before", () => {
    const { container } = render(<FinishDialogBody {...base} />);
    expect(markupOf(container.firstElementChild!)).toMatchSnapshot();
  });
});

/** True when the elements appear in this document order. */
const inOrder = (...elements: Element[]) =>
  elements.every((el, i) => i === 0 || (elements[i - 1]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);

describe("10.5 AC11 — the line and checkbox", () => {
  it("exact text, after the unlogged list, before the note; unchecked; native and labeled", () => {
    render(<FinishDialogBody {...base} oneOff={{ name: "Class Fri 16 Oct", keep: false, onKeepChange: vi.fn() }} />);
    const line = screen.getByText("'Class Fri 16 Oct' is a one-off: it leaves your routines when you finish.");
    const box = screen.getByRole("checkbox", { name: "Keep it in my routines" });
    expect(box).not.toBeChecked();
    expect(box.tagName).toBe("INPUT");
    expect(inOrder(screen.getByText("1 planned set not logged"), line, box, screen.getByText(base.note))).toBe(true);
  });

  it("toggling calls onKeepChange(true)", async () => {
    const onKeepChange = vi.fn();
    render(<FinishDialogBody {...base} oneOff={{ name: "Class", keep: false, onKeepChange }} />);
    await userEvent.setup().click(screen.getByRole("checkbox", { name: KEEP_IN_ROUTINES }));
    expect(onKeepChange).toHaveBeenCalledWith(true);
  });

  it("the name is text, never markup", () => {
    const name = `O'Brien's "Class" <img src=x onerror=alert(1)> ${"x".repeat(60)}`;
    const { container } = render(<FinishDialogBody {...base} oneOff={{ name, keep: false, onKeepChange: vi.fn() }} />);
    expect(screen.getByText(oneOffFinishLine(name))).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("the line wraps instead of widening the dialog", () =>
    expect(readFileSync(join(HERE, "FinishDialog.module.css"), "utf8")).toMatch(/\.oneOffLine\s*\{[^}]*overflow-wrap:\s*anywhere/));

  it("EndEarlyDialog passes it through", () => {
    render(
      <EndEarlyDialog
        open
        stats={base.stats}
        unitPreference="kg"
        unlogged={base.unlogged}
        busy={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        oneOff={{ name: "Class", keep: true, onKeepChange: vi.fn() }}
      />,
    );
    expect(screen.getByRole("checkbox", { name: KEEP_IN_ROUTINES, hidden: true })).toBeChecked();
  });
});

describe("10.5 AC20 — the Finish copy, exactly", () => {
  it("the line template and the label", () => {
    expect(oneOffFinishLine("N")).toBe("'N' is a one-off: it leaves your routines when you finish.");
    expect(KEEP_IN_ROUTINES).toBe("Keep it in my routines");
  });
});
