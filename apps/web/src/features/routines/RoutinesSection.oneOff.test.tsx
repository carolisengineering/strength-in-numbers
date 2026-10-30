import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { makeRoutine, makeRoutineItem, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { EMPTY_ROUTINES, LIMIT_MESSAGE, LOAD_LIST_FAILED, ONE_OFF_TAG } from "./messages";
import { oneOffDay } from "./oneOff";
import { markupOf } from "../../test/markup";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

const pushA = makeRoutine({
  id: routineId(1),
  name: "Push A",
  items: [makeRoutineItem({ position: 0, supersetGroup: 1 }), makeRoutineItem({ position: 1, supersetGroup: 1 }), makeRoutineItem({ position: 2 })],
});
const pullB = makeRoutine({ id: routineId(2), name: "Pull B" });

describe("10.5 AC2 — ordinary rows are unchanged", () => {
  it("the list of ordinary routines renders exactly as before", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ routines: [pushA, pullB] }) });
    renderApp("/app/workouts");
    expect(markupOf(await screen.findByRole("list", { name: "Routines" }))).toMatchSnapshot();
  });
});

const FUTURE = "2099-10-30T12:00:00.000Z";
const cls = makeRoutine({
  id: routineId(5),
  name: "Class Fri 16 Oct",
  oneOffUntil: FUTURE,
  createdAt: "2026-10-16T08:00:00.000Z",
  items: [1, 1, 2, 2, null, null].map((supersetGroup, position) => makeRoutineItem({ position, supersetGroup })),
});

describe("10.5 AC1 / AC2 — one-offs first, tagged, with the meta line", () => {
  it("served order; the tag inside the row link; the exact meta", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-16T09:00:00.000Z"));
    prepareApp({ auth, fake: createWorkoutFake({ routines: [pushA, cls] }) });
    renderApp("/app/workouts");
    const links = within(await screen.findByRole("list", { name: "Routines" })).getAllByRole("link");
    expect(links.map((l) => l.querySelector("span")!.textContent)).toEqual(["Class Fri 16 Oct One-off", "Push A"]);
    expect(within(links[0]!).getByText(ONE_OFF_TAG)).toBeInTheDocument();
    expect(within(links[0]!).getByText(`6 exercises · 2 supersets · from text · until ${oneOffDay(FUTURE)}`)).toBeInTheDocument();
    expect(within(links[1]!).queryByText(ONE_OFF_TAG)).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("10.5 AC4 — past expiry on the list", () => {
  it("no until once the device clock is past it; now is re-read when the data changes", async () => {
    let clock = Date.parse(FUTURE) - 60_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const fake = createWorkoutFake({ routines: [cls] });
    prepareApp({ auth, fake });
    const { queryClient } = renderApp("/app/workouts");
    const link = await screen.findByRole("link", { name: /Class Fri 16 Oct/ });
    expect(link).toHaveTextContent(`· from text · until ${oneOffDay(FUTURE)}`);
    clock = Date.parse(FUTURE) + 60_000;
    fake.state.routines.set(cls.id, { ...cls, name: "Class Fri 16 Oct!" });
    await queryClient.refetchQueries({ queryKey: ["routines", "list"] });
    const after = await screen.findByRole("link", { name: /Class Fri 16 Oct!/ });
    expect(within(after).getByText("6 exercises · 2 supersets · from text")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

describe("10.5 AC5 — the limit and load states are unchanged", () => {
  it("50 routines with one-offs → the limit state", async () => {
    const oneOffs = [0, 1].map((i) => makeRoutine({ id: routineId(100 + i), name: `Class ${i}`, oneOffUntil: FUTURE }));
    const ordinary = Array.from({ length: ROUTINES_PER_USER_MAX - 2 }, (_, i) => makeRoutine({ id: routineId(i + 1), name: `R${String(i).padStart(2, "0")}` }));
    prepareApp({ auth, fake: createWorkoutFake({ routines: [...oneOffs, ...ordinary] }) });
    renderApp("/app/workouts");
    expect(await screen.findByRole("button", { name: "New routine" })).toBeDisabled();
    expect(screen.getByText(LIMIT_MESSAGE)).toBeInTheDocument();
  });

  it("loading, error and empty render as before", async () => {
    const held = createWorkoutFake({ routines: [cls] });
    held.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => new Promise<Response>(() => {}) as unknown as Response);
    prepareApp({ auth, fake: held });
    renderApp("/app/workouts");
    expect(await screen.findByText("Loading routines…")).toHaveAttribute("role", "status");
    cleanupApp();

    const failing = createWorkoutFake({ routines: [cls] });
    failing.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => problemResponse(500, "about:blank"));
    prepareApp({ auth, fake: failing });
    renderApp("/app/workouts");
    expect(await screen.findByRole("alert")).toHaveTextContent(LOAD_LIST_FAILED);
    cleanupApp();

    prepareApp({ auth, fake: createWorkoutFake() });
    renderApp("/app/workouts");
    expect(await screen.findByText(EMPTY_ROUTINES)).toBeInTheDocument();
  });
});
