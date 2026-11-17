import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetDesktop, setDesktop } from "../test/desktop";
import { markupOf } from "../test/markup";
import { ConfirmDialog } from "./ConfirmDialog";
import { Screen } from "./Screen";
import { Sheet } from "./Sheet";

afterEach(() => resetDesktop());

describe("17.12 AC9 — with no header, a hidden title shows at desktop widths", () => {
  it("wide: the h1 of a hideTitle screen is drawn", () => {
    setDesktop(true);
    render(<Screen title="History" hideTitle />);
    expect(screen.getByRole("heading", { level: 1, name: "History" }).className).not.toMatch(/titleHidden/);
  });

  it("narrow: it stays visually hidden, where the header says the word", () => {
    setDesktop(false);
    render(<Screen title="History" hideTitle />);
    expect(screen.getByRole("heading", { level: 1, name: "History" }).className).toMatch(/titleHidden/);
  });

  it("each page still has one h1", () => {
    setDesktop(true);
    render(<Screen title="History" hideTitle />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

/** The markup of a sheet and a confirm dialog, rendered at one width. */
function overlaysAt(wide: boolean): string {
  setDesktop(wide);
  const { container, unmount } = render(
    <>
      <Sheet open title="Edit set" onClose={() => {}}>
        <p>Body</p>
      </Sheet>
      <ConfirmDialog open title="Delete this workout?" confirmLabel="Delete" variant="danger" onConfirm={() => {}} onCancel={() => {}}>
        <p>It can't be undone.</p>
      </ConfirmDialog>
    </>,
  );
  const markup = markupOf(container);
  unmount();
  resetDesktop();
  return markup;
}

describe("17.12 AC10 — sheets and dialogs are unchanged at every width", () => {
  it("a Sheet and a ConfirmDialog render the same markup wide and narrow", () => {
    expect(overlaysAt(true)).toBe(overlaysAt(false));
  });
});
