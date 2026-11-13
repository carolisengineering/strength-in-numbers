import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stripCssComments } from "../test/sourceScan";
import { Screen } from "./Screen";

const HERE = dirname(fileURLToPath(import.meta.url));
const ruleOf = (file: string, selector: string) =>
  [...stripCssComments(readFileSync(file, "utf8")).matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1]!.trim() === selector)?.[2] ?? "";

describe("17.13 AC10 — hideTitle", () => {
  it("the h1 stays in the tree, labels the section, and carries the hidden class", () => {
    render(<Screen title="History" hideTitle />);
    const h1 = screen.getByRole("heading", { level: 1, name: "History" });
    expect(h1.className).toMatch(/titleHidden/);
    expect(screen.getByRole("region", { name: "History" })).toContainElement(h1);
  });

  it("without the prop the title shows", () => {
    render(<Screen title="History" />);
    expect(screen.getByRole("heading", { level: 1, name: "History" }).className).not.toMatch(/titleHidden/);
  });
});

describe("17.13 AC11 — titleSmall", () => {
  it("draws the h1 one step smaller, with its text and role unchanged", () => {
    render(<Screen title="Workout summary" titleSmall />);
    expect(screen.getByRole("heading", { level: 1, name: "Workout summary" }).className).toMatch(/titleSmall/);
  });

  it("the CSS: .titleSmall is --font-size-lg; the workout's own title stays --font-size-xl", () => {
    expect(ruleOf(join(HERE, "Screen.module.css"), ".titleSmall")).toMatch(/font-size:\s*var\(--font-size-lg\)/);
    expect(ruleOf(join(HERE, "../features/workouts/WorkoutText.module.css"), ".title")).toMatch(/font-size:\s*var\(--font-size-xl\)/);
  });
});
