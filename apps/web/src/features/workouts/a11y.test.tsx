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

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
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

  it("field error text is an alert tied to its input", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "weight", message: "Too heavy" }] }),
    );
    const row = within(screen.getByRole("article", { name: "X" }));
    // The entry row starts from the last set, which is partial here: give it a weight so it can log.
    await user.type(row.getByLabelText("Weight"), "60");
    await user.click(row.getByRole("button", { name: "Log set" }));

    const message = await screen.findByText("Too heavy");
    expect(message.closest("[role='alert']")).not.toBeNull();
    expect(row.getByLabelText("Weight")).toHaveAccessibleDescription("Too heavy");
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
