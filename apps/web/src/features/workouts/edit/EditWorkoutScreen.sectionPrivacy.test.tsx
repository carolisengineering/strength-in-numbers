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
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { card, optionsButton } from "../../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";

const NAME = "ZebraEditQx";
const NOTE = "NoteEditQx";
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

const sheet = (name: string) => within(screen.getByRole("dialog", { name }));
const announced = () => screen.getByTestId("edit-announcement");
const leaked = () =>
  JSON.stringify([observability.track.mock.calls, observability.reportError.mock.calls.map((c) => c[1]), ...consoles.map((s) => s.mock.calls.map((c) => c.map(String)))]);

describe("10.6 AC24 — privacy on the edit screen: nothing user-derived reaches track, reportError or the console", () => {
  // Every write and failure path in one flow: ~1.5 s locally, over Vitest's 5 s default on a slow CI runner (#145 merge run).
  const LONG_FLOW_MS = 20_000;

  it("add, edit, move, remove and every failure path", async () => {
    const workout = makeWorkoutDetail({
      endedAt: "2026-10-02T11:00:00.000Z",
      sections: [{ name: "Warm-up" }],
      exercises: [
        { modality: "weight_reps", name: "Row Erg", sectionIndex: 0, sets: [makeSet({ setNumber: 1 })] },
        { modality: "weight_reps", name: "Squat", sets: [makeSet({ setNumber: 1 })] },
      ],
    });
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const { user } = renderApp(`/app/history/${workout.id}/edit`);
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });

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
    await sheet("New section").findByText(/offline/i);
    fake.setOffline(false);
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(announced()).toHaveTextContent(`Section added: ${NAME}`));

    // Edit (and its 500 path), move (and its 500 path), remove.
    await user.click(screen.getByRole("button", { name: `Edit section ${NAME}` }));
    await user.clear(sheet("Edit section").getByLabelText("Note"));
    await user.type(sheet("Edit section").getByLabelText("Note"), `${NOTE}2`);
    fake.failNext({ method: "PATCH", path: /^\/v1\/workout-sections\// }, () => problemResponse(500, "about:blank"));
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await sheet("Edit section").findByText("Couldn't save the section — try again"); // in the sheet: Save is the retry
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announced()).toHaveTextContent("Section saved"));
    await user.click(optionsButton("Squat"));
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(500, "about:blank"));
    await user.selectOptions(within(card("Squat")).getByLabelText("Section"), NAME);
    await screen.findByText("Couldn't move that exercise — try again");
    await user.selectOptions(within(card("Squat")).getByLabelText("Section"), NAME);
    await waitFor(() => expect(announced()).toHaveTextContent(`Moved Squat to ${NAME}`));
    await user.click(screen.getByRole("button", { name: `Edit section ${NAME}` }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    await user.click(sheet(`Remove ${NAME}?`).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(announced()).toHaveTextContent("Section removed"));

    expect(observability.track).toHaveBeenCalledWith("workout_edit", { edit: "section_removed" });
    expect(leaked()).not.toContain(NAME);
    expect(leaked()).not.toContain(NOTE);
    expect(leaked()).not.toContain("Squat");
  }, LONG_FLOW_MS);
});
