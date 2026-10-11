import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
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

import { API_BASE_URL } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const ex = (name: string, supersetGroup: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  supersetGroup,
  ...extra,
});

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

type Fake = ReturnType<typeof createWorkoutFake>;
const nameOf = (fake: Fake, id: string) => fake.state.active?.exercises.find((e) => e.id === id)?.exerciseNameSnapshot ?? id;
/** PATCHes as [exercise name, body], in order. Names are resolved against the fake's current state. */
const patches = (fake: Fake) =>
  fake.requests
    .filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-exercises/"))
    .map((r) => [nameOf(fake, decodeURIComponent(r.path.split("/").pop()!)), r.body]);
const activeReads = (fake: Fake) => fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;
const toggle = (above: string, below: string) => screen.getByRole("button", { name: `Superset ${above} with ${below}` });
const card = (name: string) => screen.getByRole("article", { name: new RegExp(`^${name}(,|$)`) });
const names = () => screen.getAllByRole("article").map((a) => a.getAttribute("aria-label") ?? within(a).getByRole("heading", { level: 2 }).textContent);
const brackets = () => Array.from(document.querySelectorAll("[data-bracket]")).map((e) => e.getAttribute("data-bracket"));
const openOptions = async (user: ReturnType<typeof renderApp>["user"], name: string) =>
  user.click(within(card(name)).getByRole("button", { name: "Options" }));

describe("10.1 AC17 — bracket and names on the active screen", () => {
  it("[7,7,null,3,3]: brackets only on runs; N is the on-screen ordinal; ungrouped cards keep their heading name", async () => {
    await setup([ex("A", 7, { targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8 }), ex("B", 7), ex("C"), ex("D", 3), ex("E", 3)]);
    expect(names()).toEqual(["A, superset 1, 4 × 6–8", "B, superset 1", "C", "D, superset 2", "E, superset 2"]);
    expect(card("C")).toHaveAttribute("aria-labelledby");
    expect(card("C")).not.toHaveAttribute("aria-label");
    expect(brackets()).toEqual(["first", "middle", "last", "first", "middle", "last"]);
    for (const el of document.querySelectorAll("[data-bracket]")) expect(el).toHaveAttribute("aria-hidden", "true");
  });
});

describe("10.1 AC18 — tolerant server states render without crashing", () => {
  it("a group of one, a detached member and two stretches sharing a number", async () => {
    const error = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    await setup([ex("A", 5), ex("B"), ex("C", 3), ex("D", 3), ex("E", 9), ex("F", 3), ex("G", 4), ex("H", 4), ex("I"), ex("J", 4), ex("K", 4)]);
    expect(names()).toEqual(["A", "B", "C, superset 1", "D, superset 1", "E", "F", "G, superset 2", "H, superset 2", "I", "J, superset 3", "K, superset 3"]);
    expect(brackets()).toEqual(["first", "middle", "last", "first", "middle", "last", "first", "middle", "last"]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("10.1 AC19 — link toggles", () => {
  it("one between each adjacent pair, none after the last; pressed state and label follow the link", async () => {
    await setup([ex("A", 1), ex("B", 1), ex("C")]);
    expect(toggle("A", "B")).toHaveAttribute("aria-pressed", "true");
    expect(toggle("A", "B")).toHaveTextContent("Superset ✓");
    expect(toggle("B", "C")).toHaveAttribute("aria-pressed", "false");
    expect(toggle("B", "C")).toHaveTextContent("Superset with next");
    expect(screen.getAllByRole("button", { name: /^Superset / })).toHaveLength(2);
  });
  it("the 8-member cap disables the toggle with its reason, referenced by aria-describedby", async () => {
    await setup([ex("A", 1), ex("B", 1), ex("C", 1), ex("D", 1), ex("E", 2), ex("F", 2), ex("G", 2), ex("H", 2), ex("I", 2)]);
    const capped = toggle("D", "E");
    expect(capped).toBeDisabled();
    const reason = document.getElementById(capped.getAttribute("aria-describedby")!);
    expect(reason).toHaveTextContent("A superset can have up to 8 exercises");
  });
  it("no toggle with fewer than two exercises", async () => {
    await setup([ex("A")]);
    expect(screen.queryByRole("button", { name: /^Superset / })).not.toBeInTheDocument();
  });
});

describe("10.1 AC20 — a toggle sends the planned PATCHes", () => {
  const cases: [string, ExerciseSpec[], [string, string], [string, unknown][], string[]][] = [
    ["ungrouped + ungrouped", [ex("A"), ex("B")], ["A", "B"], [["A", { supersetGroup: 1 }], ["B", { supersetGroup: 1 }]], ["A, superset 1", "B, superset 1"]],
    ["ungrouped joins a run", [ex("A"), ex("B", 2), ex("C", 2)], ["A", "B"], [["A", { supersetGroup: 2 }]], ["A, superset 1", "B, superset 1", "C, superset 1"]],
    ["run merges run (smaller renumbered)", [ex("A", 1), ex("B", 1), ex("C", 2), ex("D", 2), ex("E", 2)], ["B", "C"], [["B", { supersetGroup: 2 }], ["A", { supersetGroup: 2 }]], ["A, superset 1", "B, superset 1", "C, superset 1", "D, superset 1", "E, superset 1"]],
    ["unlink leaving a side of one", [ex("A", 1), ex("B", 1), ex("C", 1)], ["A", "B"], [["A", { supersetGroup: null }]], ["A", "B, superset 1", "C, superset 1"]],
    ["numbering with gaps", [ex("A", 1), ex("B", 1), ex("C"), ex("D", 3), ex("E", 3), ex("F"), ex("G")], ["F", "G"], [["F", { supersetGroup: 2 }], ["G", { supersetGroup: 2 }]], ["A, superset 1", "B, superset 1", "C", "D, superset 2", "E, superset 2", "F, superset 3", "G, superset 3"]],
  ];
  it.each(cases)("%s", async (_label, exercises, [above, below], expected, after) => {
    const { fake, user } = await setup(exercises);
    await user.click(toggle(above, below));
    await waitFor(() => expect(names()).toEqual(after));
    expect(patches(fake)).toEqual(expected);
  });
  it("unlink 4|4: four PATCHes, far end first", async () => {
    const eight = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => ex(n, 1));
    const { fake, user } = await setup(eight);
    await user.click(toggle("D", "E"));
    await waitFor(() => expect(names()).toContain("E, superset 2"));
    expect(patches(fake)).toEqual(["H", "G", "F", "E"].map((n) => [n, { supersetGroup: 2 }]));
  });
});

describe("10.1 AC21 — block-aware Move up / Move down", () => {
  it("an ungrouped card jumps a whole run with one position PATCH", async () => {
    const { fake, user } = await setup([ex("A"), ex("B", 1), ex("C", 1), ex("D", 1)]);
    await openOptions(user, "A");
    await user.click(within(card("A")).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(names()).toEqual(["B, superset 1", "C, superset 1", "D, superset 1", "A"]));
    expect(patches(fake)).toEqual([["A", { position: 3 }]]);
  });
  it("a grouped edge card moving outward: group PATCH first, position last", async () => {
    const { fake, user } = await setup([ex("A", 1), ex("B", 1), ex("C", 1), ex("D")]);
    await openOptions(user, "C");
    await user.click(within(card("C")).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(names()).toEqual(["A, superset 1", "B, superset 1", "D", "C"]));
    expect(patches(fake)).toEqual([["C", { supersetGroup: null }], ["C", { position: 3 }]]);
  });
  it("a swap inside a run is one position PATCH and keeps the bracket", async () => {
    const { fake, user } = await setup([ex("A", 1), ex("B", 1)]);
    await openOptions(user, "A");
    await user.click(within(card("A")).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(names()).toEqual(["B, superset 1", "A, superset 1"]));
    expect(patches(fake)).toEqual([["A", { position: 1 }]]);
  });
});

describe("10.1 AC22 — one regroup at a time", () => {
  it("every toggle, Move and Finish is disabled while a regroup is in flight; re-enabled after the refetch", async () => {
    const { user } = await setup([ex("A", null, { sets: [makeSet({ setNumber: 1 })] }), ex("B"), ex("C")]);
    const gate = deferred<void>();
    server.use(
      http.patch(`${API_BASE_URL}/v1/workout-exercises/:id`, async () => {
        await gate.promise;
        return problemResponse(500, "about:blank");
      }),
    );
    await openOptions(user, "C");
    await user.click(toggle("A", "B"));

    expect(toggle("A", "B")).toBeDisabled();
    expect(toggle("B", "C")).toBeDisabled();
    expect(within(card("C")).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    expect(toggle("A", "B").closest("[aria-busy='true']")).not.toBeNull();

    gate.resolve();
    await screen.findByRole("alert");
    await waitFor(() => expect(toggle("B", "C")).toBeEnabled());
    expect(within(card("C")).getByRole("button", { name: "Move up" })).toBeEnabled();
  });
});

describe("10.1 AC23 — a mid-plan failure stops, refetches once, and shows the truth", () => {
  const eight = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => ex(n, 1));
  const failSecond = (fake: Fake, response: () => Response) => fake.failNext({ method: "PATCH", path: /workout-exercises/ }, response, 1, 1);

  it("500: two requests, one refetch, the server's half-applied state, the banner with its request id, no Try again", async () => {
    const { fake, user } = await setup(eight);
    failSecond(fake, () => problemResponse(500, "about:blank"));
    const reads = activeReads(fake);
    await user.click(toggle("D", "E"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't change the superset — try again");
    expect(alert).toHaveTextContent(/Request ID: \S+/);
    expect(within(alert).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(patches(fake)).toHaveLength(2);
    expect(activeReads(fake) - reads).toBe(1);
    await waitFor(() => expect(names()).toEqual(["A, superset 1", "B, superset 1", "C, superset 1", "D, superset 1", "E, superset 1", "F, superset 1", "G, superset 1", "H"]));
    expect(toggle("D", "E")).toBeEnabled();
  });
  it("429 is the same generic banner", async () => {
    const { fake, user } = await setup(eight);
    failSecond(fake, () => problemResponse(429, "rate-limited"));
    await user.click(toggle("D", "E"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't change the superset — try again");
  });
  it("network: the offline message verbatim", async () => {
    const { fake, user } = await setup(eight);
    failSecond(fake, () => HttpResponse.error());
    await user.click(toggle("D", "E"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You're offline — try again when you have signal");
    expect(patches(fake)).toHaveLength(2);
  });
  it("404: a silent refetch and a stale-position conflict", async () => {
    const { fake, user } = await setup(eight);
    failSecond(fake, () => problemResponse(404, "not-found"));
    const reads = activeReads(fake);
    await user.click(toggle("D", "E"));
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("workout_conflict", { kind: "stale-position" }));
    expect(activeReads(fake) - reads).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("409 workout-finished hands back to Workouts", async () => {
    const { fake, user } = await setup([ex("A"), ex("B")]);
    fake.failNext({ method: "PATCH", path: /workout-exercises/ }, () => problemResponse(409, "workout-finished"));
    fake.state.active = null;
    await user.click(toggle("A", "B"));
    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });
});

describe("10.1 AC14 — online-only", () => {
  it("offline: the first PATCH fails at once, the offline banner shows, nothing is queued, cards unchanged", async () => {
    const { fake, user } = await setup([ex("A"), ex("B")]);
    const stored = JSON.stringify({ ...localStorage });
    fake.setOffline(true);
    await user.click(toggle("A", "B"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You're offline — try again when you have signal");
    expect(names()).toEqual(["A", "B"]);
    expect(JSON.stringify({ ...localStorage })).toBe(stored);
  });
});

describe("10.1 AC29 — regroup failures carry static tags only", () => {
  it("no id, exercise name or note reaches track / reportError on any failure path", async () => {
    const SECRET = "Secret Squat";
    const { fake, user } = await setup([ex(SECRET, 1, { notes: "secret note" }), ex("B", 1), ex("C", 1), ex("D", 1), ex("E", 1), ex("F", 1), ex("G", 1), ex("H", 1)]);
    for (const response of [() => problemResponse(500, "about:blank"), () => problemResponse(418, "teapot"), () => HttpResponse.error()]) {
      fake.failNext({ method: "PATCH", path: /workout-exercises/ }, response);
      await user.click(toggle("D", "E"));
      await screen.findByRole("alert");
    }
    const payloads = JSON.stringify([...observability.track.mock.calls, ...observability.reportError.mock.calls.map(([, ctx]) => ctx)]);
    expect(payloads).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(payloads).not.toContain(SECRET);
    expect(payloads).not.toContain("secret note");
    expect(observability.reportError.mock.calls.map(([, ctx]) => ctx)).toContainEqual({ source: "workouts", op: "regroup" });
  });
});
