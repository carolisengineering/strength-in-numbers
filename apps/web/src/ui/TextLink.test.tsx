import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { NotFound } from "../screens/NotFound";
import { stripCssComments } from "../test/sourceScan";
import { TextLink } from "./TextLink";

// Raw source of every non-test component under src.
const SOURCES = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx", "!../test/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8");
const ruleOf = (file: string, selector: string) =>
  [...stripCssComments(read(file)).matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1]!.trim() === selector)?.[2] ?? "";

describe("17.13 AC15 — alone-on-a-line links are 44 px", () => {
  it("TextLink is a router link with its own class", () => {
    render(
      <MemoryRouter>
        <TextLink to="/app/profile/hevy">Go to Hevy settings</TextLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Go to Hevy settings" });
    expect(link).toHaveAttribute("href", "/app/profile/hevy");
    expect(link.className).toMatch(/link/);
  });

  it("its rule: at least the tap target tall, its own width, underlined", () => {
    const rule = ruleOf("TextLink.module.css", ".link");
    expect(rule).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    expect(rule).toMatch(/display:\s*inline-flex/);
    expect(rule).toMatch(/align-self:\s*flex-start/);
    expect(rule).toMatch(/text-decoration:\s*underline/);
  });

  it("Not found's Go to the app is a TextLink and keeps its href", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Go to the app" });
    expect(link).toHaveAttribute("href", "/app");
    expect(link.className).toMatch(/link/);
  });

  it("Go to Hevy settings is a TextLink", () => {
    const source = read("../features/hevy/send/HevyWorkoutSection.tsx");
    expect(source).toMatch(/<TextLink to=\{HEVY_PATH\}>/);
  });

  it("the load sheet's three summaries are padded to the target, keeping the native marker", () => {
    expect(ruleOf("../features/hevy/mapping/LoadMappingSheet.module.css", ".disclosure")).toMatch(/padding-block:\s*var\(--space-3\)/);
    const sheet = read("../features/hevy/mapping/LoadMappingSheet.tsx");
    expect(sheet.match(/<summary className=\{styles\.disclosure\}>\{(SHOW_LIST|WHATS_IN_FILE)\}<\/summary>/g)).toHaveLength(3);
  });

  it("code review: no <summary> anywhere is left at the browser's bare text height", () => {
    const bare = Object.entries(SOURCES)
      .filter(([, source]) => /<summary(?![^>]*className)/.test(source))
      .map(([path]) => path);
    expect(bare).toEqual([]);
  });
});
