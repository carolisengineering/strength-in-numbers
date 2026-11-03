import { screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
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

import type { RoundTime, SectionResult, SectionTimer } from "@sin/core";
import { localStorageAdapter } from "../../storage/storage";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { OUTBOX_KEY } from "./outbox/outbox";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
const consoleError = vi.spyOn(console, "error");
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  consoleError.mockClear();
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const FOUR = [221, 218, 210, 234].map((seconds, i) => ({ round: i + 1, seconds }));
const ex = (name: string, sectionIndex: number | null): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, sets: [makeSet({ setNumber: 1 })] });

type Sec = { name: string; timer: SectionTimer | null; roundTimes?: RoundTime[]; result?: SectionResult | null };
async function setup(sections: Sec[] = [{ name: "Main", timer: SET5, roundTimes: FOUR }]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ sections, exercises: sections.map((s, i) => ex(`${s.name} lift`, i)) }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const sheet = () => within(screen.getByRole("dialog", { name: "Log result" }));
const announcement = () => screen.getByTestId("session-announcement");
const storedOps = () => JSON.parse(localStorageAdapter().get(OUTBOX_KEY) ?? '{"ops":[]}').ops as { kind: string; status: string; round?: number; body: unknown }[];
const sectionWrites = (fake: Setup["fake"]) => fake.requests.filter((r) => /round-times|\/result$/.test(r.path));
const goOffline = () => {
  online = false;
  window.dispatchEvent(new Event("offline"));
};
const goOnline = () => {
  online = true;
  window.dispatchEvent(new Event("online"));
};
async function openLog(user: Setup["user"], name = "Main") {
  await user.click(screen.getByRole("button", { name: `Log result for ${name}` }));
  return sheet();
}

describe("10.7 AC27 — the Log result sheet (live)", () => {
  it("opens from the heading with the name and plan line; Next on Round 5; Cancel returns focus to the button", async () => {
    const { user } = await setup();
    const dialog = await openLog(user);
    expect(dialog.getByText("Main")).toBeInTheDocument();
    expect(dialog.getByText("Set Timer 5 × 5:00 · total 14:43")).toBeInTheDocument();
    expect(dialog.getByLabelText("Round 5").closest("[data-round]")).toHaveTextContent("Next");
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log result" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Log result for Main" })).toHaveFocus());
  });

  it("re-opening reseeds from the projection", async () => {
    const { user } = await setup();
    let dialog = await openLog(user);
    await user.type(dialog.getByLabelText("Round 5"), "300");
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    dialog = await openLog(user);
    expect(dialog.getByLabelText("Round 5")).toHaveValue("");
  });

  it("the section removed on another device closes the sheet with its line", async () => {
    const { user, fake, queryClient } = await setup();
    await openLog(user);
    fake.state.active = { ...fake.state.active!, sections: [], exercises: fake.state.active!.exercises.map((e) => ({ ...e, sectionId: null })) };
    await queryClient.invalidateQueries({ queryKey: ["workouts", "active"] });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log result" })).toBeNull());
    expect(announcement()).toHaveTextContent("That section no longer exists");
  });

  it("the timer removed on another device closes the sheet with its line", async () => {
    const { user, fake, queryClient } = await setup();
    await openLog(user);
    fake.state.active = { ...fake.state.active!, sections: fake.state.active!.sections.map((s) => ({ ...s, timer: null, roundTimes: [] })) };
    await queryClient.invalidateQueries({ queryKey: ["workouts", "active"] });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log result" })).toBeNull());
    expect(announcement()).toHaveTextContent("This section has no timer now.");
  });

  it("an untimed section and Other exercises have no Log result", async () => {
    await setup([{ name: "Main", timer: SET5 }, { name: "Warm-up", timer: null }]);
    expect(screen.getAllByRole("button", { name: /^Log result for/ })).toHaveLength(1);
  });
});

describe("10.7 AC31 / AC33 — Save (live)", () => {
  it("an invalid round blocks the save: error, focus, nothing queued", async () => {
    const { user } = await setup();
    const dialog = await openLog(user);
    await user.type(dialog.getByLabelText("Round 5"), "501");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(dialog.getByText("Longer than the round length.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Round 5")).toHaveFocus();
    expect(storedOps()).toEqual([]);
  });

  it("a valid save closes at once and queues before any request; the status says Result saved", async () => {
    const { user, fake } = await setup();
    goOffline();
    const dialog = await openLog(user);
    await user.type(dialog.getByLabelText("Round 5"), "330");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log result" })).toBeNull());
    expect(announcement()).toHaveTextContent("Result saved");
    expect(storedOps()).toEqual([expect.objectContaining({ kind: "round", round: 5, body: { seconds: 210 } })]);
    expect(sectionWrites(fake)).toEqual([]);
  });

  it("an unchanged save closes and queues nothing", async () => {
    const { user } = await setup();
    const dialog = await openLog(user);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log result" })).toBeNull());
    expect(storedOps()).toEqual([]);
    expect(announcement()).not.toHaveTextContent("Result saved");
  });

  it("emptying Round 2 queues its clear; Clear result queues the result's clear and leaves the rounds", async () => {
    const amrap: SectionTimer = { format: "amrap", capSeconds: 720 };
    const { user } = await setup([{ name: "Main", timer: amrap, roundTimes: [{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }], result: { rounds: 5, reps: 7, finishSeconds: null, capped: false } }]);
    goOffline();
    let dialog = await openLog(user);
    await user.clear(dialog.getByLabelText("Round 2"));
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(storedOps()).toEqual([expect.objectContaining({ kind: "round", round: 2, body: { seconds: null } })]));
    dialog = await openLog(user);
    await user.click(dialog.getByRole("button", { name: "Clear result" }));
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(storedOps().map((o) => [o.kind, o.body])).toEqual([["round", { seconds: null }], ["result", null]]));
  });
});

describe("10.7 AC39 / AC41 — sync UI, the Finish gate, airplane mode", () => {
  it("offline: the heading shows the projected total and Not saved yet; SyncStatus counts the entry; Finish waits; back online it drains", async () => {
    const { user, fake } = await setup();
    goOffline();
    const dialog = await openLog(user);
    await user.type(dialog.getByLabelText("Round 5"), "330");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    const main = screen.getByRole("region", { name: "Main" });
    await waitFor(() => expect(within(main).getByText("Set Timer 5 × 5:00 · total 18:13")).toBeInTheDocument());
    expect(within(main).getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Offline — 1 timer entry will save when you're back online");
    expect(screen.getByText("1 timer entry not saved yet")).toBeInTheDocument();
    goOnline();
    await waitFor(() => expect(within(main).queryByText("Not saved yet")).toBeNull());
    expect(sectionWrites(fake)).toHaveLength(1);
    expect(screen.queryByText("1 timer entry not saved yet")).toBeNull();
  });

  it("a failed entry shows Couldn't be saved; Discard removes it and the heading reverts (Review Focus 4)", async () => {
    const { user, fake } = await setup();
    fake.failNext({ method: "PUT", path: /round-times/ }, () => problemResponse(409, "section-timer-mismatch"));
    const dialog = await openLog(user);
    await user.type(dialog.getByLabelText("Round 5"), "330");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    const main = screen.getByRole("region", { name: "Main" });
    expect(await within(main).findByText("Couldn't be saved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard 1 timer entry that couldn't be saved" }));
    await waitFor(() => expect(within(main).queryByText("Couldn't be saved")).toBeNull());
    await waitFor(() => expect(within(main).getByText("Set Timer 5 × 5:00 · total 14:43")).toBeInTheDocument());
    expect(screen.queryByText(/timer entr(y|ies) not saved yet/)).toBeNull();
    expect(observability.track.mock.calls.filter(([e]) => e === "set_sync_failed")).toEqual([["set_sync_failed", { status: 409 }]]);
  });
});

describe("10.7 AC40 — no timer change under unsent entries", () => {
  it("the Timer group is disabled with its line while the section has an entry queued; the name still saves; another section is not locked", async () => {
    const { user, fake } = await setup([{ name: "Main", timer: SET5, roundTimes: FOUR }, { name: "Other", timer: SET5 }]);
    goOffline();
    const dialog = await openLog(user);
    await user.type(dialog.getByLabelText("Round 5"), "330");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log result" })).toBeNull());
    goOnline();
    fake.setOffline(true); // the browser says online, the network fails: the entry stays queued
    await user.click(screen.getByRole("button", { name: "Edit section Main" }));
    const edit = within(screen.getByRole("dialog", { name: "Edit section" }));
    expect(edit.getByLabelText("Timer")).toBeDisabled();
    expect(edit.getByText("Wait for the logged times to save before changing the timer.")).toBeInTheDocument();
    expect(edit.getByLabelText("Name")).toBeEnabled();
    await user.click(edit.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Edit section Other" }));
    expect(within(screen.getByRole("dialog", { name: "Edit section" })).getByLabelText("Timer")).toBeEnabled();
  });
});

describe("10.7 AC43 — live events", () => {
  it("one Save with three writes tracks section_result_logged once, with the format only; nothing user-derived reaches the spies", async () => {
    const { user } = await setup([{ name: "Zebra-77", timer: SET5 }]);
    goOffline();
    const dialog = await openLog(user, "Zebra-77");
    await user.type(dialog.getByLabelText("Round 1"), "341");
    await user.type(dialog.getByLabelText("Round 2"), "338");
    await user.type(dialog.getByLabelText("Round 3"), "330");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(storedOps()).toHaveLength(3));
    expect(observability.track.mock.calls.filter(([e]) => e === "section_result_logged")).toEqual([["section_result_logged", { format: "set_timer" }]]);
    const seen = JSON.stringify([observability.track.mock.calls, observability.reportError.mock.calls, consoleError.mock.calls]);
    expect(seen).not.toContain("Zebra-77");
    expect(seen).not.toContain("221");
  });
});
