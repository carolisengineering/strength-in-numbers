import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PlannedSet } from "@sin/core";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
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

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { card, logButton, makeCurrent, optionsButton, restBetweenSets } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

const read = (path: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), "utf8");
const activeSessionCss = read("./ActiveSession.module.css");
const tokensCss = read("../../ui/tokens.css");
/** The body of the first rule whose selector starts exactly with `selector`. */
const ruleFor = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

const scroll = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scroll;
  scroll.mockReset();
  observability.track.mockClear();
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;
const ex = (name: string, o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, ...o });
const planned = (n: number, weight = 100, repsLow = 5): PlannedSet[] => Array.from({ length: n }, () => ({ setType: "working", repsLow, repsHigh: repsLow, weight, weightUnit: "kg" }));
const firstSet = (o: Record<string, unknown> = {}) => makeSet({ setNumber: 1, weight: 47.5, weightKg: 47.5, weightUnit: "kg", reps: 6, ...o });

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

const bar = () => screen.getByTestId("session-bar");
const status = () => screen.getByTestId("session-status");
const undoButton = () => within(bar()).queryByRole("button", { name: /^Undo set / });
function goOffline(fake: Fake) {
  online = false;
  fake.setOffline(true);
  window.dispatchEvent(new Event("offline"));
}
function goOnline(fake: Fake) {
  online = true;
  fake.setOffline(false);
  window.dispatchEvent(new Event("online"));
}

describe("17.5 AC1 — the offer", () => {
  it.each<[string, ExerciseSpec, string]>([
    ["weight and reps", ex("A", { sets: [firstSet()] }), "Set 2 logged · 47.5 × 6"],
    ["duration", ex("A", { modality: "duration", sets: [makeSet({ setNumber: 1, weight: null, weightKg: null, weightUnit: null, reps: null, durationS: 90 })] }), "Set 2 logged · 1:30"],
    ["calories", ex("A", { modality: "calories", sets: [makeSet({ setNumber: 1, weight: null, weightKg: null, weightUnit: null, reps: null, calories: 20 })] }), "Set 2 logged · 20 cal"],
    ["a carry", ex("A", { modality: "weight_distance", sets: [makeSet({ setNumber: 1, weight: 32, weightKg: 32, weightUnit: "kg", reps: null, distance: 40, distanceUnit: "m", distanceM: 40 })] }), "Set 2 logged · 32 · 40 m"],
    ["added weight", ex("A", { modality: "weighted_bodyweight", sets: [makeSet({ setNumber: 1, weight: 20, weightKg: 20, weightUnit: "kg", reps: 5 })] }), "Set 2 logged · +20 × 5"],
  ])("%s: names the set and its value", async (_label, spec, line) => {
    const { user } = await setup([spec]);
    await user.click(logButton("A"));
    await waitFor(() => expect(status()).toHaveTextContent(line));
    expect(undoButton()).toBeInTheDocument();
  });

  it("Log extra set offers too", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(1), sets: [firstSet({ weight: 100, weightKg: 100, reps: 5 })] })]);
    await user.click(within(card("A")).getByRole("button", { name: "Log extra set" }));
    await waitFor(() => expect(status()).toHaveTextContent("Set 2 logged · 100 × 5"));
    expect(undoButton()).toBeInTheDocument();
  });

  it("a queued log, with the device offline, offers", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    goOffline(fake);
    await user.click(logButton("A"));
    await waitFor(() => expect(undoButton()).toBeInTheDocument());
  });

  it("nothing is offered before a log", async () => {
    await setup([ex("A", { sets: [firstSet()] })]);
    expect(undoButton()).not.toBeInTheDocument();
    expect(status()).toHaveTextContent("");
  });
});

describe("17.5 AC2 — one row", () => {
  it("a sync message replaces the confirmation; Undo keeps its full name, in the bar and beside the line", async () => {
    const { fake, user } = await setup([ex("Bench Press", { sets: [firstSet()] })]);
    goOffline(fake);
    await user.click(logButton("Bench Press"));
    await waitFor(() => expect(status().textContent).toBe("1 set not saved yet"));
    expect(undoButton()).toHaveAccessibleName("Undo set 2, 47.5 × 6, Bench Press");
    expect(undoButton()!.tagName).toBe("BUTTON");
    expect(within(status()).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("17.5 AC3 — sizes", () => {
  it("Undo keeps Button's own tap target and sets no size of its own", () => {
    const rule = ruleFor(activeSessionCss, ".undo");
    expect(rule).not.toMatch(/(^|\s)(min-height|min-width|height):/);
  });
  it("the tokens stand as 17.4 left them", () => {
    expect(tokensCss).toMatch(/--session-status-height:\s*var\(--tap-target-min\)/);
    expect(tokensCss).toMatch(/--session-bar-clearance:\s*calc\(var\(--bar-action-height\) \+ var\(--session-status-height\) \+ var\(--space-1\)/);
  });
  it("Undo isn't a direct child of the bar, so the 56 px rule can't reach it", async () => {
    const { user } = await setup([ex("A", { sets: [firstSet()] })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(undoButton()).toBeInTheDocument());
    expect(undoButton()!.parentElement).not.toBe(bar());
    expect(bar().querySelectorAll(":scope > button")).toHaveLength(1);
  });
});

describe("17.5 AC4 — the button doesn't move", () => {
  it("the line keeps its reserved height, and Undo's margins add nothing to its box", () => {
    expect(ruleFor(activeSessionCss, ".sessionStatus")).toContain("min-height: var(--session-status-height)");
    expect(ruleFor(activeSessionCss, ".undo")).toContain("margin-block: calc(-1 * var(--space-1)) var(--space-1)");
  });
});

describe("17.5 AC15 — apart from Log", () => {
  it("Undo follows the text on the right, and the bar's own gap stays", async () => {
    const { user } = await setup([ex("A", { sets: [firstSet()] })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(undoButton()).toBeInTheDocument());
    expect(undoButton()!.previousElementSibling).toBe(status());
    expect(ruleFor(activeSessionCss, ".sessionBar")).toContain("row-gap: var(--space-1)");
  });
});

describe("17.5 AC8 — how long it stays", () => {
  async function offered(specs: ExerciseSpec[] = [ex("A", { sets: [firstSet()] }), ex("B")]) {
    const app = await setup(specs);
    await makeCurrent(app.user, "A");
    await app.user.click(logButton("A"));
    await waitFor(() => expect(undoButton()).toBeInTheDocument());
    return app;
  }

  it("stays through typing in the panel", async () => {
    const { user } = await offered();
    await user.type(within(card("A")).getByLabelText("Reps"), "1");
    expect(undoButton()).toBeInTheDocument();
  });

  it("stays through an auto-advance", async () => {
    const { user } = await setup([ex("A", { supersetGroup: 1, plannedSets: planned(3) }), ex("B", { supersetGroup: 1, plannedSets: planned(3) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(logButton("B")).toBeInTheDocument());
    expect(undoButton()).toHaveAccessibleName(/^Undo set 1, .*, A$/);
  });

  it("a second log replaces it", async () => {
    const { user } = await offered();
    await restBetweenSets();
    await user.click(logButton("A"));
    await waitFor(() => expect(status()).toHaveTextContent("Set 3 logged"));
    expect(undoButton()).toHaveAccessibleName(/^Undo set 3,/);
  });

  it("ends on a tap on a collapsed exercise", async () => {
    const { user } = await offered();
    await makeCurrent(user, "B");
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
    expect(status()).toHaveTextContent("");
  });

  it("ends when a set row opens the set sheet", async () => {
    const { user } = await offered();
    await user.click(within(card("A")).getAllByRole("button", { name: /47\.5 kg × 6/ })[0]!);
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
  });

  it("ends when Add note opens", async () => {
    const { user } = await offered();
    await user.click(within(card("A")).getByRole("button", { name: "Add note for A" }));
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
  });

  it("ends when the Workout menu opens", async () => {
    const { user } = await offered();
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
  });

  it("ends when Add exercise opens the picker", async () => {
    const { user } = await offered();
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
  });

  it("ends when Change Time opens", async () => {
    const { user } = await offered();
    await user.click(screen.getByRole("button", { name: "Change Time" }));
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
  });

  it("ends when the Finish dialog opens", async () => {
    const { user } = await offered();
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
  });

  it("ends when a remove dialog opens", async () => {
    const { user } = await offered();
    await user.click(optionsButton("A"));
    await user.click(screen.getByRole("button", { name: /^Remove/ }));
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
  });

  it("Options opening does not end it", async () => {
    const { user } = await offered();
    await user.click(optionsButton("A"));
    expect(undoButton()).toBeInTheDocument();
  });

  it("ends when the set is edited elsewhere", async () => {
    const { fake } = await offered();
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets).toHaveLength(2));
    fake.state.active = {
      ...fake.state.active!,
      exercises: fake.state.active!.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => (s.setNumber === 2 ? { ...s, reps: 9 } : s)) })),
    };
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
    focusManager.setFocused(undefined);
  });

  it("ends when the set is gone", async () => {
    const { fake } = await offered();
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets).toHaveLength(2));
    fake.state.active = {
      ...fake.state.active!,
      exercises: fake.state.active!.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.setNumber !== 2) })),
    };
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
    focusManager.setFocused(undefined);
  });

  it("a remount shows none: the offer is held in memory only", async () => {
    await offered();
    cleanup();
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(undoButton()).not.toBeInTheDocument();
  });
});

describe("17.5 AC16 — keyboard up", () => {
  it("an empty line takes no room, wrapper included; the 17.4 rules stand", () => {
    expect(ruleFor(activeSessionCss, ':global(:root[data-keyboard="open"]) .statusRow:has(.sessionStatus:empty)')).toContain("display: none");
    expect(ruleFor(activeSessionCss, ':global(:root[data-keyboard="open"]) .sessionStatus:empty')).toContain("display: none");
  });
});
