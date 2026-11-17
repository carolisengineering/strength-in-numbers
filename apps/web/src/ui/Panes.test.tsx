import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { resetDesktop, setDesktop } from "../test/desktop";
import { BackLink } from "./BackLink";
import { Panes } from "./Panes";
import { Screen } from "./Screen";

const HERE = dirname(fileURLToPath(import.meta.url));

function ListScreen() {
  return (
    <Screen title="History" hideTitle>
      <p>The list</p>
    </Screen>
  );
}

function FirstDetail() {
  return (
    <Screen title="Workout summary" lead={<BackLink to="/list" label="Back to History" />}>
      <label>
        Title
        <input name="title" />
      </label>
    </Screen>
  );
}

function SecondDetail() {
  return <Screen title="Another workout" />;
}

function renderPanes(path = "/list") {
  const router = createMemoryRouter(
    [
      {
        path: "/list",
        element: <Panes list={<ListScreen />} listLabel="History" detailLabel="Workout" selectedId={null} />,
        children: [
          { index: true, element: <FirstDetail /> },
          { path: "second", element: <SecondDetail /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  return { ...view, router };
}

afterEach(() => resetDesktop());

/** The panes themselves (a labelled `Screen` section is a region too, so they're found by their hook). */
const panes = () => [...document.querySelectorAll<HTMLElement>("[data-pane]")];

describe("17.12 AC13 — Panes: two panes at desktop widths, today's screen below", () => {
  it("narrow: only the route's screen, in wrappers with no roles", () => {
    renderPanes();
    expect(panes()).toEqual([]);
    expect(screen.queryByRole("region", { name: "Workout" })).toBeNull();
    expect(screen.queryByText("The list")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Workout summary" })).toBeInTheDocument();
  });

  it("wide: a list region and a detail region, named by their labels", () => {
    setDesktop(true);
    renderPanes();
    const [list, detail] = panes();
    expect(panes()).toHaveLength(2);
    expect(list).toHaveAttribute("role", "region");
    expect(detail).toHaveAttribute("role", "region");
    expect(list).toHaveAccessibleName("History");
    expect(detail).toHaveAccessibleName("Workout");
    expect(within(list!).getByText("The list")).toBeInTheDocument();
    expect(within(detail!).getByRole("heading", { level: 1, name: "Workout summary" })).toBeInTheDocument();
  });

  it("review focus 4: a resize keeps the detail's state, the same node both ways", async () => {
    const user = userEvent.setup();
    setDesktop(false);
    renderPanes();
    const field = screen.getByRole("textbox", { name: "Title" });
    await user.type(field, "Push");
    act(() => setDesktop(true));
    expect(screen.getByRole("textbox", { name: "Title" })).toBe(field);
    expect(field).toHaveValue("Push");
    act(() => setDesktop(false));
    expect(screen.getByRole("textbox", { name: "Title" })).toBe(field);
    expect(field).toHaveValue("Push");
  });
});

describe("17.12 AC16 — opening another item scrolls the detail to its top, and leaves the list where it was", () => {
  it("wide: the detail pane's scroll goes to 0, the list's stays", async () => {
    setDesktop(true);
    const { router } = renderPanes();
    const [list, detail] = panes() as [HTMLElement, HTMLElement];
    list.scrollTop = 200;
    detail.scrollTop = 300;
    await act(() => router.navigate("/list/second"));
    expect(screen.getByRole("heading", { level: 1, name: "Another workout" })).toBeInTheDocument();
    expect(detail.scrollTop).toBe(0);
    expect(list.scrollTop).toBe(200);
  });
});

describe("17.12 AC16 — the detail starts at its top when the selection changes on the same path", () => {
  // Code review #2: at /app/history the open workout is the list's first, so a delete (or a finish landing) changes
  // it with no change of path.
  it("wide: a new selectedId on the same path scrolls the detail to 0", async () => {
    const user = userEvent.setup();
    setDesktop(true);
    function Switcher() {
      const [id, setId] = useState("a");
      return (
        <>
          <button onClick={() => setId("b")}>Next newest</button>
          <Panes list={<ListScreen />} listLabel="History" detailLabel="Workout" selectedId={id} />
        </>
      );
    }
    const router = createMemoryRouter([{ path: "/list", element: <Switcher />, children: [{ index: true, element: <SecondDetail /> }] }], {
      initialEntries: ["/list"],
    });
    render(<RouterProvider router={router} />);
    const detail = panes()[1]!;
    detail.scrollTop = 300;
    await user.click(screen.getByRole("button", { name: "Next newest" }));
    expect(router.state.location.pathname).toBe("/list");
    expect(detail.scrollTop).toBe(0);
  });
});

describe("17.12 AC17 — headings and back links know their pane", () => {
  it("wide: the list's screen title is an h2 and drawn; the detail's back link is not drawn", () => {
    setDesktop(true);
    renderPanes();
    const list = panes()[0]!;
    const h2 = within(list).getByRole("heading", { level: 2, name: "History" });
    expect(h2.className).not.toMatch(/titleHidden/);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Back to History" })).toBeNull();
  });

  it("narrow: the back link is drawn, as today", () => {
    renderPanes();
    expect(screen.getByRole("link", { name: "Back to History" })).toBeInTheDocument();
  });
});

describe("17.12 AC13 — the pane rules", () => {
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const panesCss = strip(readFileSync(join(HERE, "Panes.module.css"), "utf8"));
  const shellCss = strip(readFileSync(join(HERE, "..", "app", "AppShell.module.css"), "utf8"));

  it("wide: the §6.3 grid, cap and height; each pane its own scroller", () => {
    expect(panesCss).toMatch(/grid-template-columns:\s*var\(--pane-list-width\) minmax\(0, 1fr\)/);
    expect(panesCss).toMatch(/gap:\s*var\(--space-6\)/);
    expect(panesCss).toMatch(/max-width:\s*var\(--content-max-wide\)/);
    expect(panesCss).toMatch(/margin-inline:\s*auto/);
    expect(panesCss).toMatch(/height:\s*100%/);
    expect(panesCss).toMatch(/min-height:\s*0;[^}]*overflow-y:\s*auto/);
  });

  it("narrow: the wrappers are display: contents", () => {
    expect(panesCss).toMatch(/\.root,\s*\.slot\s*\{[^}]*display:\s*contents/);
  });

  it("a pane with a bottom bar keeps focused content above it", () => {
    expect(shellCss).toMatch(/\[data-pane\]:has\(\[data-action-bar\]\)[^{]*\{[^}]*scroll-padding-bottom:\s*var\(--action-bar-clearance\)/);
  });
});
