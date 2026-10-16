import type { PlannedSet } from "@sin/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { card, logButton, optionsButton, restBetweenSets } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, deferred, fakeClient, makeQueryClient, prepareApp, renderApp } from "../../test/workoutHarness";
import { EntryRow } from "./EntryRow";
import { LogActionContext, createLogActionStore } from "./logAction";
import { LogBarButton } from "./LogBarButton";
import { WorkoutClientContext } from "./queries";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

const planned = (n: number, weight = 100, reps = 5): PlannedSet[] =>
  Array.from({ length: n }, () => ({ setType: "working", repsLow: reps, repsHigh: reps, weight, weightUnit: "kg" }));
const ex = (name: string, o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, ...o });
const bar = () => within(screen.getByTestId("session-bar"));
const setPosts = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));
const isCurrent = (name: string | RegExp) => within(card(name)).queryByRole("form") !== null;

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

describe("17.1 AC25 — the bar is the per-set action", () => {
  it("reads 'Log {values}', names the exercise, and reads 'Log set' (disabled) while the draft does not parse", async () => {
    const { user } = await setup([ex("Bench Press", { plannedSets: planned(2, 82.5) })]);
    const button = bar().getByRole("button", { name: "Log 82.5 × 5 for Bench Press" });
    expect(button).toHaveTextContent(/^Log 82.5 × 5$/);
    const weight = within(card("Bench Press")).getByLabelText("Weight");
    await user.clear(weight);
    expect(bar().getByRole("button", { name: "Log set for Bench Press" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("17.1 AC26 — one tap logs a planned set", () => {
  it("sends the row's values, setType, isComplete and the attempt key; no card button is named Log set", async () => {
    const { fake, user } = await setup([ex("Bench Press", { plannedSets: planned(2, 82.5) })]);
    expect(within(card("Bench Press")).queryByRole("button", { name: /^Log set/ })).toBeNull();
    await user.click(logButton("Bench Press"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    expect(setPosts(fake)[0]!.body).toEqual({
      setType: "working",
      weight: 82.5,
      weightUnit: "kg",
      reps: 5,
      isComplete: true,
      clientGeneratedId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });
});

describe("17.1 AC14 — auto-advance through the bar", () => {
  it("moves to the next exercise after the last planned set", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(1) }), ex("B", { plannedSets: planned(1) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(isCurrent("B")).toBe(true));
  });

  it("an extra set and an open exercise leave current alone", async () => {
    const { user } = await setup([ex("A", { sets: [makeSet({ setNumber: 1 })] }), ex("B", { plannedSets: planned(1) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(within(card("A")).getAllByRole("listitem")).toHaveLength(2));
    expect(isCurrent("A")).toBe(true);
  });

  it("typing after the tap reports advance: false (06.1 §6.5's editedSinceTap)", async () => {
    const detail = makeWorkoutDetail({ exercises: [ex("A", { plannedSets: planned(1) })] });
    const response = deferred<ReturnType<typeof makeSet>>();
    const onLogged = vi.fn();
    const store = createLogActionStore();
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <WorkoutClientContext.Provider value={fakeClient({ createSet: () => response.promise as never })}>
          <LogActionContext.Provider value={store}>
            <EntryRow exercise={detail.exercises[0]!} unitPreference="kg" onGone={() => {}} onLogged={onLogged} />
            <LogBarButton action={{ kind: "log" }} />
          </LogActionContext.Provider>
        </WorkoutClientContext.Provider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Log 100 × 5/ }));
    await user.type(screen.getByLabelText("Reps"), "1");
    response.resolve(makeSet({ setNumber: 1, workoutExerciseId: detail.exercises[0]!.id }));
    await waitFor(() => expect(onLogged).toHaveBeenCalledWith(expect.objectContaining({ advance: false, wasExtra: false })));
  });
});

describe("17.1 AC15 — superset alternation through the bar", () => {
  it("A → B → A", async () => {
    const { user } = await setup([ex("A", { supersetGroup: 1, plannedSets: planned(2) }), ex("B", { supersetGroup: 1, plannedSets: planned(2) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(isCurrent(/^B,/)).toBe(true));
    await restBetweenSets();
    await user.click(logButton("B"));
    await waitFor(() => expect(isCurrent(/^A,/)).toBe(true));
  });

  it("a double tap across the advance logs one set (the 600 ms window spans the panel swap)", async () => {
    const { fake, user } = await setup([ex("A", { supersetGroup: 1, plannedSets: planned(2) }), ex("B", { supersetGroup: 1, plannedSets: planned(2) })]);
    const button = logButton("A");
    await user.dblClick(button);
    await waitFor(() => expect(isCurrent(/^B,/)).toBe(true));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100)); // let a second (wrong) log reach the fake if one was sent
    expect(setPosts(fake)).toHaveLength(1);
  });
});

describe("17.1 AC29 — focus survives advance", () => {
  it("the bar button is one element and keeps focus across a log and an advance", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(1) }), ex("B", { plannedSets: planned(1) })]);
    const before = logButton("A");
    await user.click(before);
    await waitFor(() => expect(isCurrent("B")).toBe(true));
    expect(logButton("B")).toBe(before);
    expect(before).toHaveFocus();
  });

  it("aria-busy is set while a log is in flight, never disabled for busy", async () => {
    const detail = makeWorkoutDetail({ exercises: [ex("A", { plannedSets: planned(1) })] });
    const response = deferred<ReturnType<typeof makeSet>>();
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <WorkoutClientContext.Provider value={fakeClient({ createSet: () => response.promise as never })}>
          <LogActionContext.Provider value={createLogActionStore()}>
            <EntryRow exercise={detail.exercises[0]!} unitPreference="kg" onGone={() => {}} />
            <LogBarButton action={{ kind: "log" }} />
          </LogActionContext.Provider>
        </WorkoutClientContext.Provider>
      </QueryClientProvider>,
    );
    const button = screen.getByRole("button", { name: /^Log 100 × 5/ });
    await userEvent.setup().click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toBeEnabled();
    response.resolve(makeSet({ setNumber: 1, workoutExerciseId: detail.exercises[0]!.id }));
  });
});

describe("17.1 AC14 — the screen says what happened when current moves", () => {
  it("announces 'Set N logged' and the next exercise after an advance (the panel's own region unmounted)", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(1) }), ex("B", { plannedSets: planned(1) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(screen.getByTestId("session-announcement")).toHaveTextContent("Set 1 logged. Next: B"));
  });
});

describe("17.1 AC13 — a removed current exercise leaves no stale action on the bar", () => {
  it("after removing the only exercise the bar cannot log", async () => {
    const { user } = await setup([ex("A")]);
    await user.click(optionsButton("A"));
    await user.click(within(card("A")).getByRole("button", { name: "Remove exercise" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "A" })).not.toBeInTheDocument());
    // Spec 17.1 AC27: an empty workout's bar is Add exercise; no Log action survives the removal.
    expect(bar().queryByRole("button", { name: /^Log / })).toBeNull();
    expect(bar().getByRole("button", { name: "Add exercise" })).toBeInTheDocument();
  });
});

describe("17.1 AC20 — Enter in any number field logs a valid draft", () => {
  it.each([
    ["weight_reps", "Reps", { sets: [makeSet({ setNumber: 1 })] }],
    ["duration", "Seconds", { sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null, weightKg: null, reps: null, durationS: 90 })] }],
  ] as const)("%s: Enter in %s", async (modality, label, { sets }) => {
    const { fake, user } = await setup([{ modality, name: "X", sets: [...sets] }]);
    await user.type(within(card("X")).getByLabelText(label), "{Enter}");
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
  });

  it("Enter on an invalid draft shows every message and sends nothing (06.4 D2)", async () => {
    const { fake, user } = await setup([ex("X")]);
    await user.type(within(card("X")).getByLabelText("Weight"), "{Enter}");
    expect(within(card("X")).getAllByText("Required").length).toBeGreaterThanOrEqual(2);
    expect(setPosts(fake)).toHaveLength(0);
  });
});

describe("17.1 AC27 — Finish mode", () => {
  it("the bar reads Finish workout once every planned set is logged; the panel offers a secondary Log extra set", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(1) })]);
    await user.click(logButton("A"));
    const finish = await screen.findByRole("button", { name: "Finish workout" });
    expect(screen.getByTestId("session-bar")).toContainElement(finish);
    const extra = within(card("A")).getByRole("button", { name: "Log extra set" });
    expect(extra.className).toMatch(/secondary/);
    await restBetweenSets();
    await user.click(extra);
    await waitFor(() => expect(setPosts(fake)).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeInTheDocument();
  });

  it("a workout with no planned sets never shows Finish in the bar", async () => {
    await setup([ex("A", { sets: [makeSet({ setNumber: 1 })] })]);
    expect(bar().queryByRole("button", { name: "Finish workout" })).toBeNull();
    expect(bar().getByRole("button", { name: /^Log / })).toBeInTheDocument();
  });

  it("an empty workout shows Add exercise as the bar's button", async () => {
    await setup([]);
    expect(bar().getByRole("button", { name: "Add exercise" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add exercise" })).toHaveLength(1);
  });
});

describe("17.1 AC28 — Finish keeps every rule", () => {
  it("is disabled while a set is not saved, with today's hint", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(1) })]);
    fake.setOffline(true);
    await user.click(logButton("A"));
    expect(await screen.findByRole("button", { name: "Finish workout" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("1 set not saved yet")).toBeInTheDocument();
  });

  it("opens today's Finish dialog", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(1), sets: [makeSet({ setNumber: 1 })] })]);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    expect(screen.getByRole("dialog", { name: "Finish workout?" })).toBeInTheDocument();
  });
});

describe("17.1 AC30 — Add exercise moved into the list", () => {
  it("sits after the last row, out of the bar; a free-form workout gets a secondary Finish workout beside it", async () => {
    await setup([ex("A", { sets: [makeSet({ setNumber: 1 })] }), ex("B")]);
    const add = screen.getByRole("button", { name: "Add exercise" });
    expect(screen.getByTestId("session-bar")).not.toContainElement(add);
    expect(card("B").compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const finish = screen.getByRole("button", { name: "Finish workout" });
    expect(finish.className).toMatch(/secondary/);
    expect(screen.getByTestId("session-bar")).not.toContainElement(finish);
  });

  it("a routine workout gets no list-end Finish", async () => {
    await setup([ex("A", { plannedSets: planned(2) })]);
    expect(screen.queryByRole("button", { name: "Finish workout" })).toBeNull();
  });
});

describe("17.1 AC29 — the bar's button never takes `disabled` (a disabled button drops focus)", () => {
  const repsOnly = (n: number): PlannedSet[] => Array.from({ length: n }, () => ({ setType: "working", repsLow: 8, repsHigh: 8, weight: null, weightUnit: null }));

  it("an advance onto an exercise whose draft does not parse yet leaves the button focusable, aria-disabled, and inert", async () => {
    const { fake, user } = await setup([ex("A", { supersetGroup: 1, plannedSets: planned(2) }), ex("B", { supersetGroup: 1, plannedSets: repsOnly(2) })]);
    await user.click(logButton("A"));
    await waitFor(() => expect(isCurrent(/^B,/)).toBe(true));
    const button = bar().getByRole("button", { name: /^Log set/ });
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    await restBetweenSets();
    await user.click(button);
    expect(setPosts(fake)).toHaveLength(1);
  });

  it("Finish mode waiting on an unsaved set is aria-disabled, not disabled, and opens nothing", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(1) })]);
    fake.setOffline(true);
    await user.click(logButton("A"));
    const finish = await bar().findByRole("button", { name: "Finish workout" });
    expect(finish).not.toHaveAttribute("disabled");
    expect(finish).toHaveAttribute("aria-disabled", "true");
    await user.click(finish);
    expect(screen.queryByRole("dialog", { name: "Finish workout?" })).toBeNull();
  });
});

describe("17.1 AC29 — Enter that logs and advances hands focus to the new current card", () => {
  it("Enter in A's Reps advances to B and focuses B's heading", async () => {
    const { user } = await setup([ex("A", { supersetGroup: 1, plannedSets: planned(2) }), ex("B", { supersetGroup: 1, plannedSets: planned(2) })]);
    await user.type(within(card(/^A,/)).getByLabelText("Reps"), "{Enter}");
    await waitFor(() => expect(isCurrent(/^B,/)).toBe(true));
    await waitFor(() => expect(within(card(/^B,/)).getByRole("heading", { level: 2 })).toHaveFocus());
  });
});
