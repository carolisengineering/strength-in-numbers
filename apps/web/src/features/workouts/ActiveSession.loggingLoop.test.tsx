import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PlannedSet } from "@sin/core";
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

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));

// A held log, so a test can act between the tap and the log's success. Everything else about the mutation is real.
const hold = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
vi.mock("./useWorkoutMutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useWorkoutMutations")>();
  return {
    ...actual,
    useCreateSet: () => {
      const real = actual.useCreateSet();
      return {
        ...real,
        mutateAsync: async (variables: Parameters<typeof real.mutateAsync>[0]) => {
          if (hold.gate) await hold.gate;
          return real.mutateAsync(variables);
        },
      };
    },
  };
});

import { card, deleteSetIn, logButton, makeCurrent, restBetweenSets } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

const read = (path: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), "utf8");
const activeSessionCss = read("./ActiveSession.module.css");
const actionBarCss = read("../../ui/ActionBar.module.css");
const appShellCss = read("../../app/AppShell.module.css");
const tokensCss = read("../../ui/tokens.css");

const scroll = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scroll;
  scroll.mockReset();
  observability.track.mockClear();
  hold.gate = null;
});
afterEach(() => cleanupApp());

const planned = (n: number, weight = 100, repsLow = 5, repsHigh = 5): PlannedSet[] =>
  Array.from({ length: n }, () => ({ setType: "working", repsLow, repsHigh, weight, weightUnit: "kg" }));
const ex = (name: string, o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, ...o });
const setPosts = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));
const status = () => screen.getByTestId("session-status");
const panel = (name: string | RegExp) => within(card(name)).getByRole("form");
const scrolled = () => scroll.mock.contexts as unknown[];

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  await waitFor(() => expect(scroll).toHaveBeenCalled()); // the screen's one reveal on open (17.1 AC9)
  scroll.mockClear();
  return { fake, ...app };
}

describe("17.4 AC7 — a carried value survives leaving and returning to an exercise", () => {
  it("a superset's first exercise still shows the weight it was lifted at, after its partner's set", async () => {
    const { user } = await setup([ex("A", { supersetGroup: 1, plannedSets: planned(3) }), ex("B", { supersetGroup: 1, plannedSets: planned(3) })]);
    await user.click(within(card(/^A,/)).getByRole("button", { name: /^Increase weight/ }));
    await user.click(logButton("A"));
    await waitFor(() => expect(logButton("B")).toBeInTheDocument());
    await restBetweenSets();
    await user.click(logButton("B"));
    await waitFor(() => expect(logButton("A")).toHaveTextContent(/^Log 102.5 × 5$/));
  });
});

describe("17.4 AC7 — correcting or deleting the set just logged", () => {
  const bump = (user: Awaited<ReturnType<typeof setup>>["user"]) => user.click(within(card("A")).getByRole("button", { name: /^Increase weight/ }));
  const openRow = async (user: Awaited<ReturnType<typeof setup>>["user"], text: RegExp) => {
    await user.click(within(card("A")).getByRole("button", { name: text }));
    return within(await screen.findByRole("dialog"));
  };

  it("a corrected weight replaces the carried one, so one tap can't record the mistake", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(3) })]);
    await bump(user);
    await user.click(logButton("A"));
    await waitFor(() => expect(logButton("A")).toHaveTextContent(/^Log 102.5 × 5$/));
    const sheet = await openRow(user, /102\.5 kg × 5/);
    const weight = sheet.getByLabelText("Weight");
    await user.clear(weight);
    await user.type(weight, "97.5");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(logButton("A")).toHaveTextContent(/^Log 97.5 × 5$/));
    await restBetweenSets();
    await user.click(logButton("A"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(2));
    expect(setPosts(fake)[1]!.body).toMatchObject({ weight: 97.5 });
  });

  it("a correction never overwrites what the lifter has already changed for the next set", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) })]);
    await bump(user);
    await user.click(logButton("A"));
    await waitFor(() => expect(logButton("A")).toHaveTextContent(/^Log 102.5 × 5$/));
    await bump(user);
    const sheet = await openRow(user, /102\.5 kg × 5/);
    const weight = sheet.getByLabelText("Weight");
    await user.clear(weight);
    await user.type(weight, "97.5");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(card("A")).getByRole("button", { name: /97\.5 kg × 5/ })).toBeInTheDocument());
    expect(logButton("A")).toHaveTextContent(/^Log 105 × 5$/);
  });

  it("deleting the last set goes back to the set before it", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) })]);
    await bump(user);
    await user.click(logButton("A"));
    await waitFor(() => expect(logButton("A")).toHaveTextContent(/^Log 102.5 × 5$/));
    await restBetweenSets();
    await bump(user);
    await user.click(logButton("A"));
    await waitFor(() => expect(within(card("A")).getByRole("button", { name: /105 kg × 5/ })).toBeInTheDocument());
    const sheet = await openRow(user, /105 kg × 5/);
    await deleteSetIn(user, sheet);
    await waitFor(() => expect(logButton("A")).toHaveTextContent(/^Log 102.5 × 5$/));
  });
});

describe("17.4 AC8 — the bar tells the truth about a carried value", () => {
  it("reads the carried weight, one tap sends it, and it is not an edit", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(3) })]);
    await user.click(within(card("A")).getByRole("button", { name: /^Increase weight/ }));
    await user.click(logButton("A"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    await waitFor(() => expect(logButton("A")).toHaveTextContent(/^Log 102.5 × 5$/));

    await restBetweenSets();
    observability.track.mockClear();
    await user.click(logButton("A"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(2));
    expect(setPosts(fake)[1]!.body).toMatchObject({ weight: 102.5, weightUnit: "kg", reps: 5, isComplete: true });
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("set_logged", expect.objectContaining({ edited: false })));
  });

  it("reads the carried reps at the top of a range", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3, 100, 6, 8) })]);
    const more = within(card("A")).getByRole("button", { name: "Increase reps" });
    await user.click(more);
    await user.click(more);
    await user.click(logButton("A"));
    await waitFor(() => expect(logButton("A")).toHaveTextContent(/^Log 100 × 8$/));
  });
});

describe("17.4 AC10 — the status line is always there, above the button", () => {
  it("is present and empty with nothing to say", async () => {
    await setup([ex("A", { plannedSets: planned(2), sets: [makeSet({ setNumber: 1 })] })]);
    expect(status()).toBeEmptyDOMElement();
  });

  it("sits before the button in the bar", async () => {
    await setup([ex("A", { plannedSets: planned(2) })]);
    const follows = status().compareDocumentPosition(logButton("A")) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows).toBeTruthy();
    expect(within(screen.getByTestId("session-bar")).getByTestId("session-status")).toBe(status());
  });
});

describe("17.4 AC11 — one line, not a stack", () => {
  it("shows one message as today", async () => {
    await setup([ex("A", { plannedSets: planned(2) })]);
    expect(status()).toHaveTextContent(/^Log at least one set to finish$/);
  });

  it("joins messages with a separator", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(3) })]);
    fake.setOffline(true);
    await user.click(logButton("A"));
    await waitFor(() => expect(status()).toHaveTextContent(/^1 set not saved yet$/));
    await user.click(within(card("A")).getByRole("button", { name: /^Add note/ }));
    const sheet = within(await screen.findByRole("dialog"));
    await user.type(sheet.getByLabelText("Note"), "Felt good");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(status()).toHaveTextContent(/^1 set not saved yet · 1 note not saved yet$/));
  });
});

describe("17.4 AC9, AC12, AC13 — the bar's sizes", () => {
  const ruleFor = (css: string, selector: string) => css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));

  it("AC9: the workout bar's button uses the taller token, 56 px, and other bars keep theirs", () => {
    expect(tokensCss).toMatch(/--bar-action-height:\s*3\.5rem/);
    expect(ruleFor(activeSessionCss, ".sessionBar > button")).toContain("min-height: var(--bar-action-height)");
    expect(actionBarCss).not.toContain("--bar-action-height");
  });

  it("AC10: the status line reserves its height", () => {
    expect(tokensCss).toMatch(/--session-status-height:\s*var\(--tap-target-min\)/);
    expect(ruleFor(activeSessionCss, ".sessionStatus {")).toContain("min-height: var(--session-status-height)");
  });

  it("AC12: an empty status line gives up its space with the keyboard up, a message doesn't", () => {
    expect(ruleFor(activeSessionCss, ':global(:root[data-keyboard="open"]) .sessionStatus:empty')).toContain("display: none");
  });

  it("AC13: the workout screen's scroll padding clears the taller bar", () => {
    const clearance = ruleFor(tokensCss, "--session-bar-clearance:");
    for (const part of ["--bar-action-height", "--session-status-height", "--space-1", "--space-3", "--space-4"]) expect(clearance).toContain(part);
    expect(ruleFor(appShellCss, ".main:has([data-session-bar])")).toContain("scroll-padding-bottom: var(--session-bar-clearance)");
  });

  it("AC12, AC13: with the keyboard up and an empty status line, the padding gives that space back too", () => {
    const compact = ruleFor(tokensCss, "--session-bar-clearance-compact:");
    expect(compact).toContain("--bar-action-height");
    expect(compact).not.toContain("--session-status-height");
    expect(ruleFor(appShellCss, ':global(:root[data-keyboard="open"]) .main:has([data-session-status]:empty)')).toContain("scroll-padding-bottom: var(--session-bar-clearance-compact)");
  });
});

describe("17.4 AC14 — after a log on the same exercise", () => {
  it("reveals the panel, without smooth scrolling", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(3) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    await waitFor(() => expect(scrolled()).toContain(panel("A")));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("waits until the new row is on screen, because that row is what pushes the panel down", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) })]);
    const rowsAtReveal: number[] = [];
    scroll.mockImplementation(function (this: Element) {
      if (this.tagName === "FORM") rowsAtReveal.push(within(card("A")).queryAllByRole("listitem").length);
    });
    await user.click(logButton("A"));
    await waitFor(() => expect(rowsAtReveal).not.toHaveLength(0));
    expect(rowsAtReveal).toEqual([1]);
  });

  it("reveals it again on every log", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(scrolled()).toContain(panel("A")));
    scroll.mockClear();
    await restBetweenSets();
    await user.click(logButton("A"));
    await waitFor(() => expect(scrolled()).toContain(panel("A")));
  });
});

describe("17.4 AC15 — after an advance", () => {
  it("reveals the next exercise's panel, after its heading", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(1) }), ex("B", { plannedSets: planned(2) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(scrolled()).toContain(panel("B")));
    const heading = within(card("B")).getByRole("heading", { level: 2 });
    const order = scrolled();
    expect(order.indexOf(heading)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(heading)).toBeLessThan(order.indexOf(panel("B")));
  });

  it("logged by Enter, focus moves to the heading: the panel is revealed, then the focused heading is brought back", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(1) }), ex("B", { plannedSets: planned(2) })]);
    await user.click(within(card("A")).getByLabelText("Reps"));
    await user.keyboard("{Enter}");
    const heading = () => within(card("B")).getByRole("heading", { level: 2 });
    await waitFor(() => expect(heading()).toHaveFocus());
    await waitFor(() => expect(scrolled()).toContain(panel("B")));
    expect(scrolled().at(-1)).toBe(heading());
  });

  it("a tap that leaves focus in a field, as iPhone Safari does, still reveals the next panel", async () => {
    await setup([ex("A", { plannedSets: planned(1) }), ex("B", { plannedSets: planned(2) })]);
    within(card("A")).getByLabelText("Reps").focus();
    fireEvent.click(logButton("A")); // no focus change, unlike userEvent.click
    await waitFor(() => expect(scrolled()).toContain(panel("B")));
  });
});

describe("17.4 AC13 — the reveal never hides what has focus", () => {
  it("a field with focus is brought back after the panel's reveal", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) })]);
    const reps = within(card("A")).getByLabelText("Reps");
    await user.click(reps);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(scrolled()).toContain(panel("A")));
    expect(scrolled().at(-1)).toBe(within(card("A")).getByLabelText("Reps"));
  });

  it("the bar's own button is never scrolled to, because a sticky bar would drag the list with it", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(scrolled()).toContain(panel("A")));
    expect(scrolled()).not.toContain(logButton("A"));
  });
});

describe("17.4 AC18 — the bar's guards still hold", () => {
  it("a double tap across an advance logs one set", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(1) }), ex("B", { plannedSets: planned(2) })]);
    await user.dblClick(logButton("A"));
    await waitFor(() => expect(scrolled()).toContain(panel("B")));
    await new Promise((resolve) => setTimeout(resolve, 100)); // let a second (wrong) log reach the fake if one was sent
    expect(setPosts(fake)).toHaveLength(1);
  });

  it("focus stays on the bar's button through a log and the panel's reveal", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) })]);
    const button = logButton("A");
    await user.click(button);
    await waitFor(() => expect(scrolled()).toContain(panel("A")));
    expect(screen.getByTestId("session-bar").querySelector(":scope > button")).toHaveFocus();
  });
});

describe("17.4 AC16 — it doesn't fight the lifter", () => {
  it("doesn't scroll when the lifter typed since the tap", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(3) })]);
    const gate = deferred<void>();
    hold.gate = gate.promise;
    await user.click(logButton("A"));
    await user.type(within(card("A")).getByLabelText("Reps"), "1");
    scroll.mockClear();
    gate.resolve();
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50)); // let a wrong reveal happen if one is coming
    expect(scrolled()).not.toContain(panel("A"));
  });

  it("doesn't scroll when the lifter already made another exercise current", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(3) }), ex("B", { plannedSets: planned(3) })]);
    const gate = deferred<void>();
    hold.gate = gate.promise;
    await user.click(logButton("A"));
    await makeCurrent(user, "B");
    scroll.mockClear();
    gate.resolve();
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrolled()).not.toContain(panel("B"));
  });
});
