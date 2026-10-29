import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { endTemplatesRead, reportTemplatesPage, useTemplatesProgress } from "./templatesProgress";

function Reader() {
  const p = useTemplatesProgress();
  return <p data-testid="progress">{p === null ? "none" : `${p.page}/${p.pageCount}`}</p>;
}

afterEach(() => endTemplatesRead());

describe("Minor 197 — template read progress", () => {
  it("a reader that mounts mid-read sees the latest page at once (Review Focus 1)", () => {
    reportTemplatesPage({ page: 2, pageCount: 3 });
    render(<Reader />);
    expect(screen.getByTestId("progress")).toHaveTextContent("2/3");
  });

  it("every reader follows each page, and the end clears it", () => {
    render(
      <>
        <Reader />
        <Reader />
      </>,
    );
    expect(screen.getAllByTestId("progress").map((p) => p.textContent)).toEqual(["none", "none"]);
    act(() => reportTemplatesPage({ page: 1, pageCount: 3 }));
    act(() => reportTemplatesPage({ page: 3, pageCount: 3 }));
    expect(screen.getAllByTestId("progress").map((p) => p.textContent)).toEqual(["3/3", "3/3"]);
    act(() => endTemplatesRead());
    expect(screen.getAllByTestId("progress").map((p) => p.textContent)).toEqual(["none", "none"]);
  });
});
