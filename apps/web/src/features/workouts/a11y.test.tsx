import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false,
    isAuthenticated: true,
    error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { makePersonalRecord, makeProgressPoint, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

async function setup() {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({
      exercises: [
        {
          modality: "weight_reps",
          name: "X",
          sets: [
            makeSet({ setNumber: 1, weight: 60, reps: 8 }),
            makeSet({ setNumber: 2, weight: null, weightUnit: null, reps: 8, isComplete: false }),
          ],
        },
        { modality: "distance_duration", name: "Y" },
      ],
    }),
  });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

describe("AC33 — accessibility and one-handed layout (component level)", () => {
  it("every input, select and textarea has a programmatic label", async () => {
    await setup();

    const controls = document.querySelectorAll("input, select, textarea");
    expect(controls.length).toBeGreaterThan(8);
    for (const control of controls) expect(control).toHaveAccessibleName();
  });

  it("field error text is an alert tied to its input (client validation; 06.2 queues server errors on the row)", async () => {
    const { user } = await setup();
    const row = within(screen.getByRole("article", { name: "X" }));
    const weight = row.getByLabelText("Weight");
    await user.clear(weight);
    await user.type(weight, "abc");
    await user.tab();

    expect(weight).toHaveAttribute("aria-invalid", "true");
    const describedBy = weight.getAttribute("aria-describedby")!;
    const message = document.getElementById(describedBy.split(" ")[0]!)!;
    expect(message.closest("[role='alert']")).not.toBeNull();
    expect(weight).toHaveAccessibleDescription(message.textContent!);
  });

  it("each entry row has a polite live region for the 'Set N logged' announcement", async () => {
    await setup();

    const regions = screen.getAllByRole("status");
    expect(regions.length).toBeGreaterThanOrEqual(2); // one per card
    for (const region of regions) expect(region).toHaveAttribute("role", "status");
  });

  it("a flagged set is announced as needing data, not conveyed by colour only", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" }));

    const flagged = await screen.findByRole("button", { name: /Needs data/ });
    expect(flagged).toHaveTextContent("Needs data");
    expect(flagged).toHaveAttribute("data-needs-data", "true");
  });

  it("the sticky action bar sits above the shell navigation, and Log set is the last element of its entry row", async () => {
    await setup();

    const bar = screen.getByTestId("session-bar");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(bar.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const name of ["X", "Y"]) {
      const form = screen.getByRole("form", { name: `Log a set of ${name}` });
      expect(form.lastElementChild).toBe(within(form).getByRole("button", { name: "Log set" }));
    }
  });
});

// ---- source checks: every interactive control is at least --tap-target-min tall (04.1 AC2's technique) ----

const HERE = dirname(fileURLToPath(import.meta.url));
// Vitest does not hand back raw CSS through import.meta.glob, so read the files like the other
// stylesheet tests do (AppShell.test.tsx).
const css = new Proxy({} as Record<string, string>, {
  get: (_target, file: string) => readFileSync(join(HERE, file), "utf8"),
});
const tsx = import.meta.glob(["./*.tsx", "!./*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function hasTapTarget(file: string, selector: string): boolean {
  const source = css[file]?.replace(/\/\*[\s\S]*?\*\//g, "");
  if (source === undefined) throw new Error(`no stylesheet ${file}`);
  const rules = [...source.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  return rules.some(
    ([, selectors = "", body = ""]) =>
      // Split a selector list on top-level commas only (`:where(a, b)` keeps its own).
      selectors.split(/,(?![^(]*\))/).some((s) => s.trim() === selector) &&
      /min-height:\s*var\(--tap-target-min\)/.test(body),
  );
}

describe("AC33 — tap targets", () => {
  it.each([
    ["./ExerciseCard.module.css", ".set"],
    ["./SetFields.module.css", ".input"],
    ["./SetFields.module.css", ".select"],
    ["./SetFields.module.css", ".unit"],
    ["./SetFields.module.css", ".summary"],
    ["./FinishedWorkoutScreen.module.css", ".back"],
    ["../../ui/Button.module.css", ".button"],
    ["../../ui/Sheet.module.css", ".close"],
  ])("%s %s carries min-height: var(--tap-target-min)", (file, selector) => {
    expect(hasTapTarget(file, selector)).toBe(true);
  });

  it("the Field wrapper sizes every input, select and textarea inside it", () => {
    expect(hasTapTarget("../../ui/Field.module.css", ".field :where(input, select, textarea)")).toBe(true);
  });

  it("no raw interactive element in the feature is left unstyled (it would have no tap-target class)", () => {
    const unstyled: string[] = [];
    for (const [path, source] of Object.entries(tsx)) {
      for (const [tag] of stripComments(source).matchAll(/<(?:button|select|input|summary|Link|a)\b(?:=>|[^>])*>/g)) {
        if (!/className=/.test(tag)) unstyled.push(`${path}: ${tag.slice(0, 60)}`);
      }
    }
    expect(unstyled).toEqual([]);
  });
});

describe("08.0 AC23 — History and the records block, accessibly", () => {
  it("History has one h1, a named list of named links, and a named Load more", async () => {
    const workouts = Array.from({ length: 21 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return makeWorkoutDetail({
        startedAt: `2026-08-${day}T10:00:00.000Z`,
        endedAt: `2026-08-${day}T11:00:00.000Z`,
        localDate: `2026-08-${day}`,
        exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }],
      });
    });
    const fake = createWorkoutFake({ finished: workouts, records: [makePersonalRecord({ workoutId: workouts[20]!.id })] });
    prepareApp({ auth, fake });
    renderApp("/app/history");

    const list = await screen.findByRole("list", { name: "Finished workouts" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const links = within(list).getAllByRole("link");
    for (const link of links) expect(link).toHaveAccessibleName();
    expect(links[0]).toHaveAccessibleName(/1 personal record/);
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("the empty state is not an alert", async () => {
    prepareApp({ auth, fake: createWorkoutFake() });
    renderApp("/app/history");
    await screen.findByText("No finished workouts yet");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the records block is a named region with a list", async () => {
    const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet()] }] });
    prepareApp({ auth, fake: createWorkoutFake({ finished: [workout], records: [makePersonalRecord({ workoutId: workout.id })] }) });
    renderApp(`/app/history/${workout.id}`);
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByRole("heading", { level: 2, name: "Personal records" })).toBeInTheDocument();
    expect(within(block).getByRole("list")).toBeInTheDocument();
  });

  it.each([
    ["../history/HistoryScreen.module.css", ".row"],
    ["../history/HistoryScreen.module.css", ".emptyLink"],
  ])("%s %s carries min-height: var(--tap-target-min)", (file, selector) => {
    expect(hasTapTarget(file, selector)).toBe(true);
  });

  it("no raw interactive element in history/ or records/ is left unstyled", () => {
    const sources = import.meta.glob(
      ["../history/*.tsx", "../records/*.tsx", "!../history/*.test.tsx", "!../records/*.test.tsx"],
      { query: "?raw", import: "default", eager: true },
    ) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    const unstyled: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      for (const [tag] of stripComments(source).matchAll(/<(?:button|select|input|summary|Link|a)\b(?:=>|[^>])*>/g)) {
        if (!/className=/.test(tag)) unstyled.push(`${path}: ${tag.slice(0, 60)}`);
      }
    }
    expect(unstyled).toEqual([]);
  });
});

describe("08.1 AC25 — Progress screens, accessibly", () => {
  const ID = "10000000-0000-4000-8000-0000000000b1";

  it("list: one h1, a named list of links", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ records: [makePersonalRecord({ exerciseId: ID })] }) });
    renderApp("/app/progress");
    const list = await screen.findByRole("list", { name: "Exercises" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const link of within(list).getAllByRole("link")) expect(link).toHaveAccessibleName();
  });

  it("exercise: one h1, a named svg, named groups of pressed buttons, a live readout, nothing focusable in the svg", async () => {
    prepareApp({
      auth,
      fake: createWorkoutFake({
        progress: { [ID]: [makeProgressPoint({ localDate: "2026-09-01" }), makeProgressPoint({ localDate: "2026-10-01" })] },
        records: [makePersonalRecord({ exerciseId: ID })],
      }),
    });
    renderApp(`/app/progress/${ID}`);
    const svg = await screen.findByRole("img");
    expect(svg).toHaveAccessibleName();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const name of ["Metric", "Range"]) {
      for (const b of within(screen.getByRole("group", { name })).getAllByRole("button")) {
        expect(b).toHaveAccessibleName();
        expect(b).toHaveAttribute("aria-pressed");
      }
    }
    expect(document.querySelector("[aria-live='polite']")).not.toBeNull();
    expect(svg.querySelectorAll("[tabindex], a, button")).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["../progress/ProgressScreen.module.css", ".row"],
    ["../progress/ProgressScreen.module.css", ".emptyLink"],
    ["../progress/ExerciseProgressScreen.module.css", ".session"],
    ["../progress/ExerciseProgressScreen.module.css", ".back"],
  ])("%s %s carries min-height: var(--tap-target-min)", (file, selector) => {
    expect(hasTapTarget(file, selector)).toBe(true);
  });

  it("no raw interactive element in progress/ is left unstyled", () => {
    const sources = import.meta.glob(["../progress/*.tsx", "!../progress/*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    const unstyled: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      for (const [tag] of stripComments(source).matchAll(/<(?:button|select|input|summary|Link|a)\b(?:=>|[^>])*>/g)) {
        if (!/className=/.test(tag)) unstyled.push(`${path}: ${tag.slice(0, 60)}`);
      }
    }
    expect(unstyled).toEqual([]);
  });
});
