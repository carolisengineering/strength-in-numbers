import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { makePersonalRecord, makeProgressPoint, makeRoutine, makeRoutineItem, makeSet, makeWorkoutDetail, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { catalog, pushSectioned } from "../../test/routineFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { card, finishButton, logButton, makeCurrent, openSetOptions, optionsButton } from "../../test/sessionHelpers";

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
    const { user } = await setup();
    // Spec 17.1 AC23: Set type and the unit selects sit behind "Set options"; open it so they are still checked.
    await openSetOptions(user, card("X"));

    const controls = document.querySelectorAll("input, select, textarea");
    // Spec 17.1 AC9: collapsed rows mount no inputs, so only the current card (X) counts.
    expect(controls.length).toBeGreaterThan(3);
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
    const { user } = await setup();

    // One per card; Spec 17.1 AC9: only the current card mounts an entry row, so visit each.
    for (const name of ["X", "Y"]) {
      await makeCurrent(user, name);
      const regions = within(screen.getByRole("article", { name })).getAllByRole("status");
      expect(regions.length).toBeGreaterThanOrEqual(1);
      for (const region of regions) expect(region).toHaveAttribute("role", "status");
    }
  });

  it("a flagged set is announced as needing data, not conveyed by colour only", async () => {
    const { user } = await setup();
    await user.click(finishButton());
    await user.click(within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" }));

    const flagged = await screen.findByRole("button", { name: /Needs data/ });
    expect(flagged).toHaveTextContent("Needs data");
    expect(flagged).toHaveAttribute("data-needs-data", "true");
  });

  it("the sticky action bar sits above the shell navigation, and holds the current exercise's Log button", async () => {
    const { user } = await setup();

    const bar = screen.getByTestId("session-bar");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(bar.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const name of ["X", "Y"]) {
      await makeCurrent(user, name);
      // Spec 17.1 AC25: Log moved from the entry row to the bar.
      expect(bar).toContainElement(logButton(name));
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
    ["../../ui/BackLink.module.css", ".back"], // the summary's back link (#107)
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

describe("08.1 AC25 / 18.2 AC5 — Exercises screens, accessibly", () => {
  const ID = "10000000-0000-4000-8000-0000000000b1";

  it("list: one h1, a named list of links", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ records: [makePersonalRecord({ exerciseId: ID })] }) });
    renderApp("/app/exercises/records");
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
    renderApp(`/app/exercises/${ID}`);
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
    ["../exercises/RecordsView.module.css", ".row"],
    ["../exercises/RecordsView.module.css", ".emptyLink"],
    ["../progress/ExerciseProgressBody.module.css", ".session"],
  ])("%s %s carries min-height: var(--tap-target-min)", (file, selector) => {
    expect(hasTapTarget(file, selector)).toBe(true);
  });

  it("no raw interactive element in progress/ or exercises/ is left unstyled", () => {
    const sources = import.meta.glob(["../progress/*.tsx", "!../progress/*.test.tsx", "../exercises/*.tsx", "!../exercises/*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
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

describe("10.0 AC36 — routine screens, accessibly", () => {
  const catalog = [makeExercise({ id: exerciseId(1), name: "Bench Press" }), makeExercise({ id: exerciseId(2), name: "Barbell Row" })];
  const routine = makeRoutine({
    id: routineId(1),
    name: "Push A",
    items: [
      makeRoutineItem({ position: 0, exerciseId: exerciseId(1), supersetGroup: 1 }),
      makeRoutineItem({ position: 1, exerciseId: exerciseId(2), supersetGroup: 1 }),
    ],
  });

  it("Start screen: one h1 (Start a workout), a named list of links", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [routine] }) });
    renderApp("/app/workouts");
    const list = await screen.findByRole("list", { name: "Routines" });
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Start a workout"]);
    for (const link of within(list).getAllByRole("link")) expect(link).toHaveAccessibleName();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("preview: one h1, a list whose rows name their group", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [routine] }) });
    renderApp(`/app/workouts/routines/${routineId(1)}`);
    const list = await screen.findByRole("list", { name: "Exercises" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const row of within(list).getAllByRole("listitem")) expect(row.getAttribute("aria-label")).toMatch(/superset 1/);
  });

  it("editor: one h1, pressed toggles naming both exercises, edge moves disabled not hidden", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [routine] }) });
    const { user } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    const list = await screen.findByRole("list", { name: "Exercises" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const toggle = within(list).getByRole("button", { name: "Superset Bench Press with Barbell Row" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const first = within(list).getAllByRole("listitem")[0]!;
    await user.click(within(first).getByRole("button", { name: "Options" }));
    expect(within(first).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(list).getByRole("button", { name: "Bench Press, superset 1" })).toBeInTheDocument();
  });
});

describe("10.1 AC27 — session supersets, accessibly", () => {
  it("grouped card name, real toggle buttons with aria-pressed and both names, cap reason described, bracket hidden, tap-target buttons", async () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const groups = [1, 1, 1, 1, 2, 2, 2, 2, 2, null];
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({
        exercises: names.map((name, i) => ({ modality: "weight_reps" as const, name, supersetGroup: groups[i] ?? null, targetSets: i === 0 ? 3 : null })),
      }),
    });
    prepareApp({ auth, fake });
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });

    expect(screen.getByRole("article", { name: "A, superset 1, 3 sets" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "E, superset 2" })).toBeInTheDocument();
    const linked = screen.getByRole("button", { name: "Superset A with B" });
    expect(linked.tagName).toBe("BUTTON");
    expect(linked).toHaveAttribute("aria-pressed", "true");
    await makeCurrent(user, /^I,/); // Spec 17.1 AC16: toggles show only beside the current card
    expect(screen.getByRole("button", { name: "Superset I with J" })).toHaveAttribute("aria-pressed", "false");
    await makeCurrent(user, /^D,/);
    const capped = screen.getByRole("button", { name: "Superset D with E" });
    expect(capped).toBeDisabled();
    expect(document.getElementById(capped.getAttribute("aria-describedby")!)).toHaveTextContent("A superset can have up to 8 exercises");
    const brackets = document.querySelectorAll("[data-bracket]");
    expect(brackets.length).toBeGreaterThan(0);
    for (const el of brackets) expect(el).toHaveAttribute("aria-hidden", "true");
    for (const button of screen.getAllByRole("button", { name: /^Superset / })) expect(button.className).toMatch(/_button_/);
  });
});

describe("10.2 AC34 — the entry-row label", () => {
  it("is plain text in the form; the form keeps its accessible name", async () => {
    await setup();
    const form = screen.getByRole("form", { name: "Log a set of X" });
    const label = within(form).getByText(/^Set \d+/);
    expect(label.tagName).toBe("P");
    expect(label).not.toHaveAttribute("role");
  });
});

async function sessionWithSections() {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({
      routineName: "Push B",
      routineNotes: "Keep it short",
      sections: [{ name: "Warm-up", notes: "5 min rower" }, { name: "Main" }],
      exercises: [
        { modality: "weight_reps", name: "Bench press", sectionIndex: 1, supersetGroup: 1 },
        { modality: "weight_reps", name: "Row", sectionIndex: 1, supersetGroup: 1 },
      ],
    }),
  });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

describe("10.3 AC37 — accessibility (component level): session", () => {
  it("each section is a region named by its heading; heading, note, then the cards read in that order", async () => {
    await sessionWithSections();
    const main = screen.getByRole("region", { name: "Main" });
    const heading = within(main).getByRole("heading", { level: 2, name: "Main" });
    const cards = within(main).getAllByRole("article");
    for (const card of cards) expect(heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const warm = screen.getByRole("region", { name: "Warm-up" });
    expect(within(warm).getByRole("heading", { level: 2 }).compareDocumentPosition(within(warm).getByText("5 min rower")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the routine-note toggle has aria-expanded and a name that includes its target", async () => {
    const { user } = await sessionWithSections();
    const toggle = screen.getByRole("button", { name: "Hide routine note" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Show routine note" })).toHaveAttribute("aria-expanded", "false");
  });

  it("controls name their target ('Edit note for Bench press'); a disabled Move says why in text, not a tooltip", async () => {
    const { user } = await sessionWithSections();
    expect(screen.getByRole("button", { name: "Add note for Bench press" })).toBeInTheDocument(); // present only once Tasks 10-12 exist
    await user.click(optionsButton("Bench press, superset 1"));
    const up = within(screen.getByRole("article", { name: /^Bench press/ })).getByRole("button", { name: "Move up" });
    expect(up).toBeDisabled();
    expect(up).toHaveAccessibleDescription("First exercise in this section");
    expect(up).not.toHaveAttribute("title");
  });

  it("every input, select and textarea has a programmatic label", async () => {
    await sessionWithSections();
    for (const control of document.querySelectorAll("input, select, textarea")) expect(control).toHaveAccessibleName();
  });
});

describe("10.3 AC37 — accessibility (component level): editor", () => {
  it("regions, starters as a labeled group, targeted control names, disabled reasons in text", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushSectioned] }) });
    const { user } = renderApp(`/app/workouts/routines/${routineId(2)}/edit`);
    await screen.findByLabelText("Name");
    expect(screen.getByRole("region", { name: "Warm-up" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Main" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Options for section Warm-up" }));
    const up = screen.getByRole("button", { name: "Move Warm-up up" });
    expect(up).toBeDisabled();
    expect(up).toHaveAccessibleDescription("This is the first section");
    expect(up).not.toHaveAttribute("title");
    expect(screen.getByRole("button", { name: "Delete section Warm-up" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = await screen.findByRole("dialog", { name: "Add section" });
    expect(within(dialog).getByRole("group", { name: "Section names" })).toBeInTheDocument();
    for (const control of dialog.querySelectorAll("input, select, textarea")) expect(control).toHaveAccessibleName();
  });
});

describe("17.1 AC38 — no bare button names on the session screen", () => {
  async function three() {
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({
        exercises: [
          { modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 })] },
          { modality: "bodyweight_reps", name: "Pull-up" },
          { modality: "weight_reps", name: "Row" },
        ],
      }),
    });
    prepareApp({ auth, fake });
    const app = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    return { fake, ...app };
  }
  const names = () => screen.getAllByRole("button").map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim());

  it("every visible button name is unique or carries its exercise", async () => {
    const { user } = await three();
    await user.click(screen.getByRole("button", { name: "Options for Bench" }));
    await user.click(screen.getByRole("button", { name: "Set options" }));
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    const all = names();
    for (const bare of ["Options", "Log set", "More", "Edit", "Discard"]) expect(all).not.toContain(bare);
    const repeated = all.filter((n, i) => all.indexOf(n) !== i);
    // The open Workout menu's item and the list end's Finish workout (AC30, AC33) open the same dialog: one action,
    // one name (WCAG 3.2.4 consistent identification), so that pair is the only repeat allowed without an exercise.
    const sameAction = ["Finish workout"];
    expect(repeated.filter((n) => !sameAction.includes(n) && !["Bench", "Pull-up", "Row"].some((e) => n.includes(e)))).toEqual([]);
  });

  it("the steppers say what they step, by the draft's unit", async () => {
    await three();
    expect(screen.getByRole("button", { name: "Decrease weight by 2.5 kg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Increase weight by 2.5 kg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decrease reps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Increase reps" })).toBeInTheDocument();
  });

  it("a failed row's actions name the set and the exercise", async () => {
    const { fake, user } = await three();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(422, "validation-error", { errors: [{ path: "weight", message: "Too heavy" }] }));
    await user.click(logButton("Bench"));
    expect(await screen.findByRole("button", { name: "Edit set 2 of Bench" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard set 2 of Bench" })).toBeInTheDocument();
    // The sync line's Discard says what it throws away (no bare "Discard" on the session screen).
    expect(within(screen.getByTestId("sync-status")).getByRole("button", { name: "Discard 1 set that couldn't be saved" })).toBeInTheDocument();
  });
});

describe("17.2 AC30 — the record cards are accessible", () => {
  it("heading order is h1 then h2 then h3, the chips are plain list items, and nothing relies on color", async () => {
    const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }] });
    const e = workout.exercises[0]!;
    const mine = (o: Record<string, unknown>) => makePersonalRecord({ workoutId: workout.id, exerciseId: e.exerciseId, sourceExerciseId: e.exerciseId, exerciseName: "Bench Press", sourceSetId: e.sets[0]!.id, ...o });
    prepareApp({
      auth,
      fake: createWorkoutFake({
        finished: [workout],
        records: [mine({ recordType: "heaviest_weight", value: 102.5, previousValue: 100 }), mine({ recordType: "best_est_1rm", value: 120, previousValue: null })],
      }),
    });
    renderApp(`/app/workouts/${workout.id}`);
    const block = await screen.findByRole("region", { name: "Personal records" });
    const levels = within(screen.getByRole("main")).getAllByRole("heading").map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    expect(levels.indexOf(2)).toBeLessThan(levels.indexOf(3));
    expect(within(block).getByRole("heading", { level: 3, name: "Bench Press" })).toBeInTheDocument();
    const chips = within(block).getByRole("list", { name: "Also set records for Bench Press" });
    expect(within(chips).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Est. 1RM"]);
    expect(within(chips).queryByRole("link")).toBeNull();
    expect(within(chips).queryByRole("button")).toBeNull();
    expect(within(block).getByText("+2.5 kg")).toBeInTheDocument(); // the gain is text, not a color
  });
});

describe("18.0 AC57 — Details accessible", () => {
  it("the sheet labels both fields and ties an error to its control; long text wraps on the summary", async () => {
    const notes = "x".repeat(4000);
    const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", title: "T".repeat(120), notes, exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }] });
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const { user } = renderApp(`/app/history/${workout.id}/edit`);
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    const sheet = screen.getByRole("dialog", { name: "Details" });
    const title = within(sheet).getByLabelText("Title");
    expect(within(sheet).getByLabelText("Notes")).toHaveAccessibleName("Notes");
    await user.type(title, "x");
    await user.click(within(sheet).getByRole("button", { name: "Save details" }));
    expect(title).toHaveAccessibleDescription(/Title can be at most 120 characters\./);
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByRole("heading", { name: "Workout summary" });
    const shownTitle = screen.getByText("T".repeat(120));
    const shownNotes = screen.getByText(notes);
    expect(shownTitle.className).toMatch(/title/);
    expect(shownNotes.className).toMatch(/notes/);
    expect(css["WorkoutText.module.css"]).toMatch(/\.title\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css["WorkoutText.module.css"]).toMatch(/\.notes\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/);
  });
});

describe("18.0 AC44 — the edit screen is accessible (component level)", () => {
  async function editScreen(sets = [makeSet({ setNumber: 1, weight: 60, reps: 8 }), makeSet({ setNumber: 2, weight: 80, reps: 5 })]) {
    const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises: [{ modality: "weight_reps", name: "Bench Press", sets }] });
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const app = renderApp(`/app/history/${workout.id}/edit`);
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    return { fake, ...app };
  }

  it("one h1, the cards as h2; the banner is not a live region; one polite status line", async () => {
    await editScreen();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Edit workout"]);
    expect(within(screen.getByRole("article", { name: "Bench Press" })).getByRole("heading", { level: 2, name: "Bench Press" })).toBeInTheDocument();
    const banner = screen.getByText(/^Editing .* workout$/);
    expect(banner).not.toHaveAttribute("role");
    expect(banner).not.toHaveAttribute("aria-live");
    expect(screen.getAllByRole("status")).toEqual([screen.getByTestId("edit-announcement")]);
  });

  it("the edit and Add set sheets label every control; a field error is an alert tied to its input", async () => {
    const { user, fake } = await editScreen();
    await user.click(within(card("Bench Press")).getByRole("button", { name: /80 kg × 5/ }));
    const editSheet = screen.getByRole("dialog", { name: /^Set 2/ });
    for (const control of editSheet.querySelectorAll("input, select, textarea")) expect(control).toHaveAccessibleName();
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, () => problemResponse(422, "validation-error", { errors: [{ path: "reps", message: "Required" }] }));
    await user.clear(within(editSheet).getByLabelText("Reps"));
    await user.type(within(editSheet).getByLabelText("Reps"), "6");
    await user.click(within(editSheet).getByRole("button", { name: "Save" }));
    const reps = within(editSheet).getByLabelText("Reps");
    await vi.waitFor(() => expect(reps).toHaveAccessibleDescription(/Required/));
    await user.click(within(editSheet).getByRole("button", { name: "Close" }));
    await user.click(within(card("Bench Press")).getByRole("button", { name: "Add set to Bench Press" }));
    const addSheet = screen.getByRole("dialog", { name: "New set · Bench Press" });
    for (const control of addSheet.querySelectorAll("input, select, textarea")) expect(control).toHaveAccessibleName();
  });

  it("the last-set dialog starts on Cancel (Keep it)", async () => {
    const { user } = await editScreen([makeSet({ setNumber: 1, weight: 60, reps: 8 })]);
    await user.click(within(card("Bench Press")).getByRole("button", { name: /60 kg × 8/ }));
    await user.click(within(screen.getByRole("dialog", { name: /^Set 1/ })).getByRole("button", { name: "Delete set" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this whole workout instead?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep it" }));
  });
});

describe("18.0 AC44 — Change Time is accessible (component level)", () => {
  it("live: one Change Time button; every sheet input is named; Hours and Minutes sit in the group Took; a Took error is an alert tied to both", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: "Change Time" }));
    expect(screen.getAllByRole("button", { name: "Change Time" })).toHaveLength(1);
    const sheet = screen.getByRole("dialog", { name: "Change Time" });
    for (const control of sheet.querySelectorAll("input")) expect(control).toHaveAccessibleName();
    const took = within(sheet).getByRole("group", { name: "Took" });
    const inputs = [within(took).getByLabelText("Hours"), within(took).getByLabelText("Minutes")];
    fireEvent.change(inputs[0]!, { target: { value: "1.5" } });
    await user.click(within(sheet).getByRole("button", { name: "Save time" }));
    const error = within(sheet).getByText("Use whole numbers: hours 0–24, minutes 0–59.");
    expect(error).toHaveAttribute("role", "alert");
    for (const input of inputs) expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
  });

  it("edit: one Change Time button; with the sheet open the screen still has one status line", async () => {
    const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1 })] }] });
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const { user } = renderApp(`/app/history/${workout.id}/edit`);
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    expect(screen.getAllByRole("button", { name: "Change Time" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Change Time" }));
    expect(screen.getAllByRole("status")).toEqual([screen.getByTestId("edit-announcement")]);
  });
});

describe("10.5 AC24 — one-off controls, accessibly", () => {
  const oneOff = makeRoutine({
    id: routineId(50),
    name: "Class Fri 16 Oct",
    oneOffUntil: "2099-10-30T12:00:00.000Z",
    items: [makeRoutineItem({ exerciseId: catalog[0]!.id })],
  });

  it("the tag is text inside the row link and inside the preview's region", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [oneOff] }) });
    const { user } = renderApp("/app/workouts");
    const link = await screen.findByRole("link", { name: /One-off/ });
    expect(within(link).getByText("One-off")).toBeInTheDocument();
    await user.click(link);
    const region = await screen.findByRole("region", { name: "Class Fri 16 Oct" });
    expect(within(region).getByText("One-off")).toBeInTheDocument();
  });

  it("the checkbox is native, labeled and keyboard-togglable; Cancel still takes focus first", async () => {
    const active = makeWorkoutDetail({ routineName: oneOff.name, routineIsOneOff: true, exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }] });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [oneOff], active, activeRoutineId: oneOff.id }) });
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    await user.click(finishButton());
    const dialog = screen.getByRole("dialog", { name: "Finish workout?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep logging" }));
    const box = within(dialog).getByRole("checkbox", { name: "Keep it in my routines" });
    expect(box.tagName).toBe("INPUT");
    expect(box.closest("label")).not.toBeNull();
    for (let i = 0; i < 10 && document.activeElement !== box; i += 1) await user.tab({ shift: true });
    expect(box).toHaveFocus();
    await user.keyboard(" ");
    expect(box).toBeChecked();
  });

  it("Keep's busy, disabled and status states are exposed", async () => {
    const fake = createWorkoutFake({ catalog, routines: [oneOff] });
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(`/app/workouts/routines/${oneOff.id}`);
    const keep = await screen.findByRole("button", { name: "Keep as a routine" });
    let release!: () => void;
    fake.failNext({ method: "POST", path: /\/keep$/ }, () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(null, { status: 204 }));
      }) as unknown as Response,
    );
    await user.click(keep);
    expect(keep).toHaveAttribute("aria-busy", "true");
    expect(keep).toBeDisabled();
    release();
    // Amended by deferred minor 47: announced through a polite live region present from first paint, not a status role.
    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent("Kept in your routines."));
  });
});

describe("10.6 AC25 — section controls, accessibly", () => {
  async function liveWithSections() {
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({
        sections: [{ name: "Warm-up", notes: "5 min rower" }, { name: "Cooldown", addedInWorkout: true }],
        exercises: [
          { modality: "weight_reps", name: "Row Erg", sectionIndex: 0, supersetGroup: 1 },
          { modality: "weight_reps", name: "Squat", sectionIndex: 0, supersetGroup: 1 },
          { modality: "weight_reps", name: "Bench", sectionIndex: null, sets: [makeSet({ setNumber: 1 })] },
        ],
      }),
    });
    prepareApp({ auth, fake });
    const app = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    return { fake, ...app };
  }

  it("headings: each section a region named by its h2, Edit names unique per section; the empty line, the line and the list end are present", async () => {
    await liveWithSections();
    const edits = screen.getAllByRole("button", { name: /^Edit section / });
    expect(edits.map((b) => b.getAttribute("aria-label"))).toEqual(["Edit section Warm-up", "Edit section Cooldown"]);
    for (const name of ["Warm-up", "Cooldown"]) {
      const region = screen.getByRole("region", { name });
      expect(within(region).getByRole("button", { name: `Edit section ${name}` })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("region", { name: "Cooldown" })).getByText("No exercises yet.")).toBeInTheDocument();
    expect(screen.getByText("Cooldown", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add section" })).toBeEnabled();
  });

  it("the New section sheet: a labeled dialog, labeled fields, the hint linked, a field error announced and linked", async () => {
    const { user } = await liveWithSections();
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = screen.getByRole("dialog", { name: "New section" });
    for (const control of dialog.querySelectorAll("input, textarea")) expect(control).toHaveAccessibleName();
    expect(within(dialog).getByLabelText("Note")).toHaveAccessibleDescription("Anything beyond sets and reps.");
    await user.click(within(dialog).getByRole("button", { name: "Add section" }));
    const error = within(dialog).getByText("Enter a name.");
    expect(error).toHaveAttribute("role", "alert");
    expect(within(dialog).getByLabelText("Name").getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
  });

  it("Options: the Section select is labeled and the superset line is linked to it", async () => {
    const { user } = await liveWithSections();
    await makeCurrent(user, /^Row Erg/);
    await user.click(optionsButton(/^Row Erg/));
    const select = within(card(/^Row Erg/)).getByRole("combobox", { name: "Section" });
    expect(select).toHaveAccessibleDescription("Changing the section takes it out of its superset.");
  });

  it("the remove confirm focuses Cancel; success is announced in the status line, never as an alert", async () => {
    const { user } = await liveWithSections();
    await user.click(screen.getByRole("button", { name: "Edit section Cooldown" }));
    await user.click(within(screen.getByRole("dialog", { name: "Edit section" })).getByRole("button", { name: "Remove section" }));
    const confirm = screen.getByRole("dialog", { name: "Remove Cooldown?" });
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByTestId("session-announcement")).toHaveTextContent("Section removed"));
    expect(screen.getByTestId("session-announcement")).toHaveAttribute("role", "status");
    expect(screen.queryAllByRole("alert").filter((a) => /Section/.test(a.textContent ?? ""))).toEqual([]);
  });

  it.each([
    ["./sections/SectionPicker.module.css", ".select"],
    ["./sections/SectionSheet.module.css", ".input"],
  ])("%s %s carries min-height: var(--tap-target-min)", (file, selector) => {
    expect(hasTapTarget(file, selector)).toBe(true);
  });
});

describe("10.6 AC25 — the edit screen's section controls, accessibly", () => {
  async function editWithSections() {
    const workout = makeWorkoutDetail({
      endedAt: "2026-10-02T11:00:00.000Z",
      sections: [{ name: "Warm-up", notes: "5 min rower" }, { name: "Cooldown", addedInWorkout: true }],
      exercises: [
        { modality: "weight_reps", name: "Row Erg", sectionIndex: 0, sets: [makeSet({ setNumber: 1 })] },
        { modality: "weight_reps", name: "Bench", sectionIndex: null, sets: [makeSet({ setNumber: 1 })] },
      ],
    });
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const app = renderApp(`/app/history/${workout.id}/edit`);
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    return { fake, ...app };
  }

  it("headings are regions named by their h2 with unique Edit names; the empty line, the line and the list end are present", async () => {
    await editWithSections();
    expect(screen.getAllByRole("button", { name: /^Edit section / }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Edit section Warm-up",
      "Edit section Cooldown",
    ]);
    expect(within(screen.getByRole("region", { name: "Cooldown" })).getByText("No exercises yet.")).toBeInTheDocument();
    expect(screen.getByText("Cooldown", { selector: "strong" })).toBeInTheDocument();
    const addSection = screen.getByRole("button", { name: "Add section" });
    expect(addSection.parentElement).toBe(screen.getByRole("button", { name: "Add exercise" }).parentElement);
  });

  it("the Edit section sheet: a labeled dialog with labeled fields and the hint linked", async () => {
    const { user } = await editWithSections();
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    const dialog = screen.getByRole("dialog", { name: "Edit section" });
    for (const control of dialog.querySelectorAll("input, textarea")) expect(control).toHaveAccessibleName();
    expect(within(dialog).getByLabelText("Note")).toHaveAccessibleDescription("Anything beyond sets and reps.");
  });

  it("Options: the Section select is labeled", async () => {
    const { user } = await editWithSections();
    await user.click(optionsButton("Bench"));
    expect(within(card("Bench")).getByRole("combobox", { name: "Section" })).toBeInTheDocument();
  });

  it("the remove confirm focuses Cancel; success goes to the edit screen's status line, never an alert", async () => {
    const { user } = await editWithSections();
    await user.click(screen.getByRole("button", { name: "Edit section Cooldown" }));
    await user.click(within(screen.getByRole("dialog", { name: "Edit section" })).getByRole("button", { name: "Remove section" }));
    const confirm = screen.getByRole("dialog", { name: "Remove Cooldown?" });
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByTestId("edit-announcement")).toHaveTextContent("Section removed"));
    expect(screen.getByTestId("edit-announcement")).toHaveAttribute("role", "status");
    expect(screen.queryAllByRole("alert").filter((a) => /Section/.test(a.textContent ?? ""))).toEqual([]);
  });

  it("the edit screen's list end lets its buttons wrap and the limit line is muted text", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "edit/EditWorkoutScreen.module.css"), "utf8");
    expect(css).toMatch(/\.listEnd \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.limit \{[^}]*color: var\(--color-muted\)/);
  });
});
