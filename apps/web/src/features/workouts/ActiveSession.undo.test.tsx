import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PlannedSet } from "@sin/core";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import type { MouseEvent } from "react";
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

import { card, deleteSetIn, logButton, makeCurrent, optionsButton, restBetweenSets } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, fakeClient, makeQueryClient, prepareApp, renderApp, wrapperWith } from "../../test/workoutHarness";
import { localStorageAdapter } from "../../storage/storage";
import { REST_KEY, type RestStore } from "./restStore";
import { useUndoLastLog } from "./useUndoLastLog";

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

const deletes = (fake: Fake) => fake.requests.filter((r) => r.method === "DELETE" && r.path.startsWith("/v1/sets/"));
const posts = (fake: Fake) => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));
const setsOf = (fake: Fake) => fake.state.active!.exercises[0]!.sets;
const rows = (name: string, pattern: RegExp) => within(card(name)).queryAllByRole("button", { name: pattern });
const announced = () => screen.getByTestId("session-announcement");
const storedRest = () => localStorageAdapter().get(REST_KEY);

async function logThenOffer(user: UserEvent, name = "A") {
  await user.click(logButton(name));
  await waitFor(() => expect(undoButton()).toBeInTheDocument());
}

describe("17.5 AC5, AC7 — Undo is the same delete, online or off", () => {
  it("offline, an unsent create: canceled, with no request ever sent", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    goOffline(fake);
    await logThenOffer(user);
    await user.click(undoButton()!);
    await waitFor(() => expect(rows("A", /47\.5 kg × 6/)).toHaveLength(1));
    await waitFor(() => expect(status().textContent).toBe("Set 2 undone"));
    goOnline(fake);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts(fake)).toHaveLength(0);
    expect(deletes(fake)).toHaveLength(0);
  });

  it("online, a synced set: exactly one DELETE for its server id", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    await logThenOffer(user);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(2));
    const serverId = setsOf(fake)[1]!.id;
    await user.click(undoButton()!);
    await waitFor(() => expect(deletes(fake)).toHaveLength(1));
    expect(deletes(fake)[0]!.path).toBe(`/v1/sets/${serverId}`);
    await waitFor(() => expect(status().textContent).toBe("Set 2 undone"));
    expect(setsOf(fake)).toHaveLength(1);
  });

  it("offline, a synced set: the row leaves, the line is honest, Finish waits, and it lands once back online", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    await logThenOffer(user);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(2));
    await waitFor(() => expect(status().textContent).toBe("Set 2 logged · 47.5 × 6"));
    goOffline(fake);
    await user.click(undoButton()!);
    await waitFor(() => expect(status().textContent).toBe("Undoing set 2… · 1 set not saved yet"));
    expect(rows("A", /47\.5 kg × 6/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeDisabled();
    goOnline(fake);
    await waitFor(() => expect(status().textContent).toBe("Set 2 undone"));
    expect(setsOf(fake)).toHaveLength(1);
  });

  it("a create that syncs while the offer is up: Undo sends the server id, and the set is gone", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    goOffline(fake);
    await logThenOffer(user);
    goOnline(fake);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(2));
    await waitFor(() => expect(status().textContent).toBe("Set 2 logged · 47.5 × 6"));
    const serverId = setsOf(fake)[1]!.id;
    await user.click(undoButton()!);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(1));
    expect(deletes(fake)[0]!.path).toBe(`/v1/sets/${serverId}`);
  });
});

describe("17.5 AC6 — a failed Undo", () => {
  it("the row returns with Couldn't save, the line says nothing of its own, and Discard works", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    await logThenOffer(user);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(2));
    await waitFor(() => expect(status().textContent).toBe("Set 2 logged · 47.5 × 6"));
    fake.failNext({ method: "DELETE", path: /\/v1\/sets\// }, () => problemResponse(403, "forbidden"));
    await user.click(undoButton()!);
    await waitFor(() => expect(within(card("A")).getAllByText(/Couldn't save/).length).toBeGreaterThan(0));
    await waitFor(() => expect(rows("A", /47\.5 kg × 6/)).toHaveLength(2));
    expect(status().textContent).not.toMatch(/undone|Undoing/);
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeDisabled();
    await user.click(within(card("A")).getByRole("button", { name: /^Discard/ }));
    await waitFor(() => expect(within(card("A")).queryByText(/Couldn't save/)).not.toBeInTheDocument());
    expect(status().textContent).not.toMatch(/undone|Undoing/);
    expect(setsOf(fake)).toHaveLength(2);
  });

  it("a create the server rejects once its Undo is queued: the row returns with Couldn't save too", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(503, "unavailable"));
    await logThenOffer(user);
    await waitFor(() => expect(posts(fake)).toHaveLength(1));
    goOffline(fake);
    await user.click(undoButton()!);
    await waitFor(() => expect(status().textContent).toBe("Undoing set 2… · 1 set not saved yet"));
    expect(rows("A", /47\.5 kg × 6/)).toHaveLength(1);
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(422, "validation-failed"));
    goOnline(fake);
    await waitFor(() => expect(within(card("A")).getAllByText(/Couldn't save/).length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(rows("A", /47\.5 kg × 6/)).toHaveLength(2);
    expect(status().textContent).not.toMatch(/undone|Undoing/);
  }, 15_000);
});

describe("17.5 AC9 — the rest", () => {
  const rested = (o: Partial<ExerciseSpec> = {}) => ex("A", { restSeconds: 120, plannedSets: planned(3), ...o });

  it("an Undo clears the rest the log started", async () => {
    const { user } = await setup([rested()]);
    await logThenOffer(user);
    expect(storedRest()).not.toBeNull();
    await user.click(undoButton()!);
    await waitFor(() => expect(storedRest()).toBeNull());
  });

  it("clears it with a typed draft too (O2)", async () => {
    const { user } = await setup([rested()]);
    await logThenOffer(user);
    await user.type(within(card("A")).getByLabelText("Reps"), "1");
    await user.click(undoButton()!);
    await waitFor(() => expect(storedRest()).toBeNull());
  });

  it("a log that cleared a rest leaves it cleared: an earlier rest doesn't restart", async () => {
    const plan: PlannedSet[] = [
      { setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" },
      { setType: "warmup", repsLow: 5, repsHigh: 5, weight: 50, weightUnit: "kg" },
      { setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" },
    ];
    const { user } = await setup([rested({ plannedSets: plan })]);
    await logThenOffer(user);
    expect(storedRest()).not.toBeNull();
    await restBetweenSets();
    await user.click(logButton("A"));
    await waitFor(() => expect(undoButton()).toHaveAccessibleName(/^Undo set 2,/));
    expect(storedRest()).toBeNull();
    await user.click(undoButton()!);
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
    await waitFor(() => expect(logButton("A")).toHaveTextContent("Log 50 × 5"));
    expect(storedRest()).toBeNull();
  });

  it("a different running rest is left alone", async () => {
    const set = makeSet({ setNumber: 1 });
    const exercise = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "A", sets: [set] }] }).exercises[0]!;
    const rest = { get: () => ({ startedAt: 2000, durationS: 60 }), start: vi.fn(), clear: vi.fn(), subscribe: vi.fn() } as unknown as RestStore;
    const { result } = renderHook(
      () => useUndoLastLog({ exercises: [exercise], ops: [], idMap: {}, rest, select: vi.fn(), focusLeavesWith: () => false, revealPanel: vi.fn(), onFailure: vi.fn(), announce: vi.fn() }),
      { wrapper: wrapperWith(makeQueryClient(), fakeClient({ deleteSet: () => Promise.resolve() })) },
    );
    act(() => result.current.offerFrom({ exerciseId: exercise.id, set, advance: true, wasExtra: false, value: "60 × 8" }, { name: "A", modality: "weight_reps" }, 1000));
    await waitFor(() => expect(result.current.offer).not.toBeNull());
    act(() => result.current.undo({ currentTarget: document.createElement("button") } as unknown as MouseEvent<HTMLButtonElement>));
    await waitFor(() => expect(result.current.undoText).toBe("Set 1 undone"));
    expect(rest.clear).not.toHaveBeenCalled();
  });
});

describe("17.5 AC10 — back to the exercise", () => {
  it("after an auto-advance in a superset, the logged card is current again, shown without stealing focus", async () => {
    const { user } = await setup([ex("A", { supersetGroup: 1, plannedSets: planned(3) }), ex("B", { supersetGroup: 1, plannedSets: planned(3) })]);
    await logThenOffer(user);
    await waitFor(() => expect(logButton("B")).toBeInTheDocument());
    const logTap = bar().querySelector(":scope > button");
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    scroll.mockClear();
    await user.click(undoButton()!);
    await waitFor(() => expect(logButton("A")).toBeInTheDocument());
    await waitFor(() => expect(scroll.mock.contexts as unknown[]).toContain(within(card(/^A,/)).getByRole("form")));
    for (const [options] of scroll.mock.calls) expect(options).toEqual({ block: "nearest" });
    expect(logTap).toHaveFocus();
  });
});

describe("17.5 AC11 — the values come back", () => {
  it("a warm-up's weight, reps and type return, and one tap re-logs them as a prefill under a new key", async () => {
    const warm: PlannedSet[] = [{ setType: "warmup", repsLow: 5, repsHigh: 5, weight: 50, weightUnit: "kg" }, ...planned(2)];
    const { fake, user } = await setup([ex("A", { plannedSets: warm })]);
    await logThenOffer(user);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(1));
    const undoneKey = setsOf(fake)[0]!.clientGeneratedId;
    await user.click(undoButton()!);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(0));
    await waitFor(() => expect(logButton("A")).toHaveTextContent("Log 50 × 5"));
    expect(within(card("A")).getByRole("form")).toHaveAttribute("data-set-type", "warmup");
    observability.track.mockClear();
    await restBetweenSets();
    await user.click(logButton("A"));
    await waitFor(() => expect(setsOf(fake)).toHaveLength(1));
    expect(setsOf(fake)[0]).toMatchObject({ setType: "warmup", weight: 50, reps: 5 });
    expect(setsOf(fake)[0]!.clientGeneratedId).not.toBe(undoneKey);
    expect(observability.track).toHaveBeenCalledWith("set_logged", expect.objectContaining({ edited: false }));
  });
});

describe("17.5 AC12 — Finish mode", () => {
  it("Undo of the last planned set returns the bar to Log, focus unchanged, with one primary", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(1) })]);
    const button = logButton("A");
    await logThenOffer(user);
    await waitFor(() => expect(button).toHaveTextContent("Finish workout"));
    await user.click(undoButton()!);
    await waitFor(() => expect(button).toHaveTextContent(/^Log /));
    expect(button).toHaveFocus();
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
  });
});

describe("17.5 AC13 — focus and announcement", () => {
  it("a pointer tap leaves focus on Log, and the result is announced", async () => {
    const { user } = await setup([ex("A", { sets: [firstSet()] })]);
    const button = logButton("A");
    await logThenOffer(user);
    await user.click(undoButton()!);
    await waitFor(() => expect(announced()).toHaveTextContent(/^Set 2 undone$/));
    expect(button).toHaveFocus();
  });

  it("a keyboard activation moves focus to Log, because Undo unmounts", async () => {
    const { user } = await setup([ex("A", { sets: [firstSet()] })]);
    const button = logButton("A");
    await logThenOffer(user);
    await user.tab({ shift: true });
    expect(undoButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });

  it("focus in the card Undo collapses moves to Log, so it isn't lost with the card", async () => {
    const { user } = await setup([ex("A", { supersetGroup: 1, plannedSets: planned(3) }), ex("B", { supersetGroup: 1, plannedSets: planned(3) })]);
    await logThenOffer(user);
    await waitFor(() => expect(logButton("B")).toBeInTheDocument());
    act(() => within(card(/^B,/)).getByLabelText("Reps").focus());
    await user.click(undoButton()!);
    await waitFor(() => expect(logButton("A")).toBeInTheDocument());
    expect(logButton("A")).toHaveFocus();
  });

  it("focus in the card Undo keeps stays where it is", async () => {
    const { user } = await setup([ex("A", { sets: [firstSet()] })]);
    await logThenOffer(user);
    const reps = within(card("A")).getByLabelText("Reps");
    act(() => reps.focus());
    await user.click(undoButton()!);
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
    expect(reps).toHaveFocus();
  });

  it("an Undo, a re-log and another Undo are each announced, though the words repeat", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    goOffline(fake);
    await logThenOffer(user);
    await user.click(undoButton()!);
    await waitFor(() => expect(announced()).toHaveTextContent(/^Set 2 undone$/));
    await restBetweenSets();
    const panelRegion = within(card("A")).getByRole("status");
    expect(panelRegion).toBeEmptyDOMElement();
    await logThenOffer(user);
    expect(panelRegion).toHaveTextContent(/^Set 2 logged$/);
    const spoken: (string | null)[] = [];
    const observer = new MutationObserver(() => spoken.push(announced().textContent));
    observer.observe(announced(), { subtree: true, childList: true, characterData: true });
    await user.click(undoButton()!);
    await waitFor(() => expect(spoken).toContain("Set 2 undone"));
    observer.disconnect();
  });

  it("offline, then online: Undoing set N, then Set N undone", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    await logThenOffer(user);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(2));
    await waitFor(() => expect(status().textContent).toBe("Set 2 logged · 47.5 × 6"));
    goOffline(fake);
    await user.click(undoButton()!);
    await waitFor(() => expect(announced()).toHaveTextContent(/^Undoing set 2$/));
    goOnline(fake);
    await waitFor(() => expect(announced()).toHaveTextContent(/^Set 2 undone$/));
  });

  it("names the button in full, and the line isn't a live region", async () => {
    const { user } = await setup([ex("Bench Press", { sets: [firstSet()] })]);
    await logThenOffer(user, "Bench Press");
    expect(undoButton()).toHaveAccessibleName("Undo set 2, 47.5 × 6, Bench Press");
    expect(status()).not.toHaveAttribute("role");
    expect(status()).not.toHaveAttribute("aria-live");
  });
});

describe("17.5 AC22 — what 17.4 and 17.1 promised still holds", () => {
  it("one primary, focus on the bar's own button, and the line still reserved after an Undo", async () => {
    const { user } = await setup([ex("A", { sets: [firstSet()] })]);
    await logThenOffer(user);
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    expect(bar().querySelector(":scope > button")).toHaveFocus();
    await user.click(undoButton()!);
    await waitFor(() => expect(undoButton()).not.toBeInTheDocument());
    expect(bar().querySelector(":scope > button")).toHaveFocus();
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    expect(status()).toHaveAttribute("data-session-status");
    expect(ruleFor(activeSessionCss, ".sessionStatus")).toContain("min-height: var(--session-status-height)");
  });
});

describe("17.5 AC21 — nothing brings it back", () => {
  it("Delete set offers no Undo, and tracks viaUndo false", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    await user.click(within(card("A")).getByRole("button", { name: /47\.5 kg × 6/ }));
    await deleteSetIn(user, screen.getByRole("dialog", { name: /^Set 1/ }));
    await waitFor(() => expect(setsOf(fake)).toHaveLength(0));
    expect(undoButton()).not.toBeInTheDocument();
    expect(observability.track).toHaveBeenCalledWith("set_deleted", { modality: "weight_reps", viaUndo: false });
  });
});

describe("17.5 AC14 — double taps", () => {
  it("two clicks on the same Undo delete one set", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    await logThenOffer(user);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(2));
    const button = undoButton()!;
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(setsOf(fake)).toHaveLength(1));
    expect(observability.track.mock.calls.filter(([name]) => name === "set_deleted")).toEqual([["set_deleted", { modality: "weight_reps", viaUndo: true }]]);
  });

  it("a double tap on Log makes one create and one offer", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    await user.dblClick(logButton("A"));
    await waitFor(() => expect(setsOf(fake)).toHaveLength(2));
    expect(posts(fake)).toHaveLength(1);
    expect(undoButton()).toHaveAccessibleName(/^Undo set 2,/);
  });

  it("Undo, then Log inside 600 ms, logs", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()] })]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await logThenOffer(user);
      await waitFor(() => expect(setsOf(fake)).toHaveLength(2));
      await user.click(undoButton()!);
      await waitFor(() => expect(setsOf(fake)).toHaveLength(1));
      await user.click(logButton("A"));
      await waitFor(() => expect(posts(fake)).toHaveLength(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
