import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { beginTemplatesRead, endTemplatesRead, reportTemplatesPage, resetTemplatesProgress, useTemplatesProgress } from "./templatesProgress";

function Reader() {
  const p = useTemplatesProgress();
  return <p data-testid="progress">{p === null ? "none" : `${p.page}/${p.pageCount}`}</p>;
}

afterEach(() => resetTemplatesProgress());

describe("Minor 197 — template read progress", () => {
  it("a reader that mounts mid-read sees the latest page at once (Review Focus 1)", () => {
    const read = beginTemplatesRead();
    reportTemplatesPage(read, { page: 2, pageCount: 3 });
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
    let read = 0;
    act(() => {
      read = beginTemplatesRead();
    });
    expect(screen.getAllByTestId("progress").map((p) => p.textContent)).toEqual(["1/1", "1/1"]);
    act(() => reportTemplatesPage(read, { page: 1, pageCount: 3 }));
    act(() => reportTemplatesPage(read, { page: 3, pageCount: 3 }));
    expect(screen.getAllByTestId("progress").map((p) => p.textContent)).toEqual(["3/3", "3/3"]);
    act(() => endTemplatesRead(read));
    expect(screen.getAllByTestId("progress").map((p) => p.textContent)).toEqual(["none", "none"]);
  });
});

describe("Minor 230 — a late end from an older read", () => {
  it("an older read's page or end never touches a newer read's progress", () => {
    render(<Reader />);
    let older = 0;
    let newer = 0;
    act(() => {
      older = beginTemplatesRead();
      newer = beginTemplatesRead();
    });
    act(() => reportTemplatesPage(newer, { page: 2, pageCount: 3 }));
    act(() => endTemplatesRead(older));
    act(() => reportTemplatesPage(older, { page: 3, pageCount: 3 }));
    expect(screen.getByTestId("progress")).toHaveTextContent("2/3");
    act(() => endTemplatesRead(newer));
    expect(screen.getByTestId("progress")).toHaveTextContent("none");
  });
});
