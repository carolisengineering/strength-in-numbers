import { render, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
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

import type { SectionTimer } from "@sin/core";
import { makeTimedSectionSummary, makeWorkoutDetail, makeWorkoutSummary, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse, type WorkoutFakeOptions } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { HistoryRow } from "../history/HistoryRow";
import { SessionSection } from "./SessionSectionHeading";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
const consoleError = vi.spyOn(console, "error");
const consoleWarn = vi.spyOn(console, "warn");
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  consoleError.mockClear();
  consoleWarn.mockClear();
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const MARKUP = "<img src=x onerror=alert(1)>";
const SECRET = "Zqxv Main";
const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const ROUNDS = [
  { round: 1, seconds: 221 },
  { round: 2, seconds: 218 },
];

async function live(opts: WorkoutDetailOptions, fakeOptions: Partial<WorkoutFakeOptions> = {}) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail(opts), ...fakeOptions });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
type Live = Awaited<ReturnType<typeof live>>;

const sheet = (name: string) => within(screen.getByRole("dialog", { name }));
async function saveAmrap(user: Live["user"], name: string) {
  await user.click(screen.getByRole("button", { name: `Edit section ${name}` }));
  await user.selectOptions(sheet("Edit section").getByLabelText("Timer"), "amrap");
  await user.type(sheet("Edit section").getByLabelText("Time limit"), "1200");
  await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
}

/** Everything the spies saw, as one string. */
const seen = () =>
  JSON.stringify(
    [observability.track.mock.calls, observability.reportError.mock.calls, consoleError.mock.calls, consoleWarn.mock.calls],
    (_k, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message } : v),
  );
const expectNothingUserDerived = () => {
  const text = seen();
  for (const needle of [SECRET, "Zqxv", "3:41", "221", "218", "12:00", "720"]) expect(text, needle).not.toContain(needle);
};

describe("10.7 AC58 — Phase B privacy and text as text", () => {
  it("a section name with markup renders as text in the heading, the plan line, the confirm title and the Log result label", async () => {
    const { user } = await live({ sections: [{ name: MARKUP, timer: SET5, roundTimes: ROUNDS }], exercises: [{ modality: "weight_reps", name: "Thruster", sectionIndex: 0 }] });
    expect(screen.getByRole("heading", { level: 2, name: MARKUP })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: MARKUP })).getByText("Set Timer 5 × 5:00 · total 7:19")).toBeInTheDocument();
    await saveAmrap(user, MARKUP);
    expect(await screen.findByRole("dialog", { name: `Change ${MARKUP}'s timer?` })).toBeInTheDocument();
    cleanupApp();
    render(
      <>
        <SessionSection heading={MARKUP} notes={null} timing={{ timer: SET5, result: null, roundTimes: ROUNDS }} onLogResult={() => {}}>
          {[]}
        </SessionSection>
        <MemoryRouter>
          <HistoryRow workout={makeWorkoutSummary({ timedSections: [makeTimedSectionSummary({ name: MARKUP, roundTimes: ROUNDS })] })} unitPreference="kg" />
        </MemoryRouter>
      </>,
    );
    // The component-level heading and (since Phase C) the live screen's both name the button after the section.
    expect(screen.getAllByRole("button", { name: `Log result for ${MARKUP}` }).length).toBeGreaterThan(0);
    expect(screen.getByText(`${MARKUP} · Set Timer 5 × 5:00 · total 7:19`)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("a timer save, a 409, a 422 and an offline save hand nothing user-derived to track, reportError or the console", async () => {
    const { user, fake } = await live({ sections: [{ name: SECRET, timer: SET5 }], exercises: [{ modality: "weight_reps", name: "Thruster", sectionIndex: 0 }] });
    // A plain save.
    await saveAmrap(user, SECRET);
    await waitFor(() => expect(screen.getByTestId("session-announcement")).toHaveTextContent("Timer saved"));
    // A 409 section-result-exists (another device logged times).
    fake.state.active = { ...fake.state.active!, sections: fake.state.active!.sections.map((s) => ({ ...s, roundTimes: ROUNDS })) };
    await user.click(screen.getByRole("button", { name: `Edit section ${SECRET}` }));
    await user.selectOptions(sheet("Edit section").getByLabelText("Timer"), "set_timer");
    await user.type(sheet("Edit section").getByLabelText("Rounds"), "5");
    await user.type(sheet("Edit section").getByLabelText("Round length"), "500");
    fake.failNext({ method: "PATCH", path: /^\/v1\/workout-sections\// }, () => problemResponse(409, "section-result-exists"));
    // Fresh state shows times, so Save asks first; confirm, and the (stale) server still refuses.
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    const confirm = screen.queryByRole("dialog", { name: /timer\?$/ });
    if (confirm) await user.click(within(confirm).getByRole("button", { name: "Change and clear" }));
    await sheet("Edit section").findByText("Times were logged for this section. Check them and try again.");
    // A 422 on a timer field.
    fake.failNext({ method: "PATCH", path: /^\/v1\/workout-sections\// }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "timer.rounds", message: `${SECRET} 221` }] }),
    );
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    const again = screen.queryByRole("dialog", { name: /timer\?$/ });
    if (again) await user.click(within(again).getByRole("button", { name: "Change and clear" }));
    await sheet("Edit section").findByText("Rounds go from 1 to 100.");
    // Offline.
    fake.setOffline(true);
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    const offline = screen.queryByRole("dialog", { name: /timer\?$/ });
    if (offline) await user.click(within(offline).getByRole("button", { name: "Change and clear" }));
    await sheet("Edit section").findByText("You're offline — try again when you have signal");
    expectNothingUserDerived();
  });

  it("a failed regroup and its Try again hand nothing user-derived to the spies", async () => {
    const { user } = await live(
      { sections: [{ name: SECRET }], exercises: [{ modality: "weight_reps", name: "A", sectionIndex: 0 }, { modality: "weight_reps", name: "B", sectionIndex: 0 }] },
      { failRegroup: { times: 1 } },
    );
    await saveAmrap(user, SECRET);
    await screen.findByText("Timer saved, but the exercises couldn't be grouped — try again");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(/couldn't be grouped/)).toBeNull());
    expectNothingUserDerived();
  });
});
