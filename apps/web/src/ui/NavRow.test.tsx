import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { NavRow } from "./NavRow";

// Raw source of every non-test component under the Hevy feature.
const hevy = import.meta.glob(["../features/hevy/**/*.tsx", "!../features/hevy/**/*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const source = (end: string) => Object.entries(hevy).find(([path]) => path.endsWith(end))![1];

function renderRow(chevron?: boolean) {
  const router = createMemoryRouter([{ path: "/", element: <NavRow to="/next" chevron={chevron}>Review pairings</NavRow> }]);
  render(<RouterProvider router={router} />);
}

describe("minor 553 — a navigation row is one shared look", () => {
  it("is a link with its text; the chevron is hidden from the name", () => {
    renderRow(true);
    const link = screen.getByRole("link", { name: "Review pairings" });
    expect(link).toHaveAttribute("href", "/next");
    expect(link).toHaveTextContent("Review pairings ›");
    expect(link.querySelector('[aria-hidden="true"]')).toHaveTextContent("›");
  });

  it("without chevron, no ›", () => {
    renderRow();
    expect(screen.getByRole("link", { name: "Review pairings" })).not.toHaveTextContent("›");
  });

  it("the Hevy screens' five rows use it, and their own link classes are gone", () => {
    expect(source("import/ImportCard.tsx")).toMatch(/<NavRow to=\{HEVY_IMPORT_PATH\}>/);
    expect(source("mapping/MappingCard.tsx")).toMatch(/<NavRow to=\{PAIRINGS_PATH\} chevron>/);
    expect(source("import/DoneStep.tsx").match(/<NavRow /g)).toHaveLength(2);
    expect(source("import/ImportSummaryView.tsx")).toMatch(/<NavRow to=\{HEVY_PATH\}>/);
    for (const [path, text] of Object.entries(hevy)) {
      expect(text, path).not.toMatch(/styles\.(link|review)\b/);
    }
  });

  it("the preflight's Profile link sits in a sentence, so it is a plain link with no 44 px class", () => {
    expect(source("import/PreflightStep.tsx")).toMatch(/<Link to="\/app\/profile">/);
  });
});
