import { screen, waitFor, within } from "@testing-library/react";
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

import { card, makeCurrent, optionsButton } from "../../test/sessionHelpers";
import { makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

const NAME = "ZebraSecQx";
const NOTE = "NoteSecQx";
const MARKUP = "<img src=x onerror=alert(1)>";
const consoles = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  for (const spy of consoles) spy.mockClear();
  cleanupApp();
});

const ex = (name: string, sectionIndex: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, ...extra });
async function setup(opts: WorkoutDetailOptions) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail(opts) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const sheet = (name: string) => within(screen.getByRole("dialog", { name }));
const leaked = () =>
  JSON.stringify([observability.track.mock.calls, observability.reportError.mock.calls.map((c) => c[1]), ...consoles.map((s) => s.mock.calls.map((c) => c.map(String)))]);

describe("10.6 AC24 — privacy: nothing user-derived reaches track, reportError or the console", () => {
  // Every write and failure path in one flow: ~1.5 s locally, over Vitest's 5 s default on a slow CI runner (#145 merge run).
  const LONG_FLOW_MS = 20_000;

  it("add, edit, move, remove and every failure path", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Warm-up" }], exercises: [ex("Row Erg", 0), ex("Squat")] });
    const add = async () => {
      await user.click(screen.getByRole("button", { name: "Add section" }));
      await user.type(sheet("New section").getByLabelText("Name"), NAME);
      await user.type(sheet("New section").getByLabelText("Note"), NOTE);
      await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    };
    // Failures first: 500 (unconfirmed), unknown 409 (reported), 422, offline.
    fake.failNext({ method: "POST", path: /\/sections$/ }, () => problemResponse(500, "about:blank"));
    await add();
    await screen.findByText(/Couldn't confirm that section was added/);
    fake.failNext({ method: "POST", path: /\/sections$/ }, () => problemResponse(409, "mystery"));
    await add();
    await waitFor(() => expect(observability.reportError).toHaveBeenCalled());
    fake.failNext({ method: "POST", path: /\/sections$/ }, () => problemResponse(422, "validation-error", { errors: [{ path: "name", message: "bad" }] }));
    await add();
    await sheet("New section").findByText("Check the name and note and try again.");
    await user.click(sheet("New section").getByRole("button", { name: "Cancel" }));
    fake.setOffline(true);
    await add();
    await sheet("New section").findByText(/You're offline/);
    fake.setOffline(false);
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(screen.getByTestId("session-announcement")).toHaveTextContent(`Section added: ${NAME}`));
    // Edit (and its 404 path), move (and its 500 path), remove.
    await user.click(screen.getByRole("button", { name: `Edit section ${NAME}` }));
    await user.clear(sheet("Edit section").getByLabelText("Note"));
    await user.type(sheet("Edit section").getByLabelText("Note"), `${NOTE}2`);
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("session-announcement")).toHaveTextContent("Section saved"));
    await makeCurrent(user, "Squat");
    await user.click(optionsButton("Squat"));
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(500, "about:blank"));
    await user.selectOptions(within(card("Squat")).getByLabelText("Section"), NAME);
    await screen.findByText("Couldn't move that exercise — try again");
    await user.selectOptions(within(card("Squat")).getByLabelText("Section"), NAME);
    await waitFor(() => expect(screen.getByTestId("session-announcement")).toHaveTextContent(`Moved Squat to ${NAME}`));
    await user.click(screen.getByRole("button", { name: `Edit section ${NAME}` }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    await user.click(sheet(`Remove ${NAME}?`).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByTestId("session-announcement")).toHaveTextContent("Section removed"));

    expect(observability.track).toHaveBeenCalled();
    expect(leaked()).not.toContain(NAME);
    expect(leaked()).not.toContain(NOTE);
    expect(leaked()).not.toContain("Squat");
  }, LONG_FLOW_MS);
});

describe("10.6 AC24 — a name with markup renders as text everywhere (Review Focus 3)", () => {
  it("heading, Edit name, the line, the select option, the status line and the confirm title", async () => {
    const forty = `${MARKUP}${"x".repeat(40 - MARKUP.length)}`;
    const { user } = await setup({ sections: [{ name: forty, addedInWorkout: true }], exercises: [ex("Row Erg")] });
    expect(document.querySelector("img")).toBeNull();
    const region = screen.getByRole("region", { name: forty });
    expect(within(region).getByRole("heading", { level: 2 })).toHaveTextContent(forty);
    expect(screen.getByRole("button", { name: `Edit section ${forty}` })).toBeInTheDocument();
    expect(screen.getByText(forty, { selector: "strong" })).toBeInTheDocument();
    await makeCurrent(user, "Row Erg");
    await user.click(optionsButton("Row Erg"));
    const option = within(within(card("Row Erg")).getByLabelText("Section")).getByRole("option", { name: forty });
    // userEvent matches option text through innerHTML (escaped), so pick the element itself.
    await user.selectOptions(within(card("Row Erg")).getByLabelText("Section"), option);
    await waitFor(() => expect(screen.getByTestId("session-announcement")).toHaveTextContent(`Moved Row Erg to ${forty}`));
    await user.click(screen.getByRole("button", { name: `Edit section ${forty}` }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    expect(screen.getByRole("dialog", { name: `Remove ${forty}?` })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
