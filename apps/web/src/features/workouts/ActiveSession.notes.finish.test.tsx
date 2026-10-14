import { cleanup, screen, waitFor, within } from "@testing-library/react";
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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { onlineManager } from "@tanstack/react-query";
import { clearUserData } from "../../storage/clearUserData";
import { localStorageAdapter } from "../../storage/storage";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { OUTBOX_KEY } from "./outbox/outbox";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;

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

async function setupNotes(notes: string | null = "Pause every rep") {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", notes, sets: [makeSet({ setNumber: 1 })] }, { modality: "weight_reps", name: "Y" }] }),
  });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const openSheet = async (user: Awaited<ReturnType<typeof setupNotes>>["user"], label: string) => {
  await user.click(screen.getByRole("button", { name: label }));
  return within(await screen.findByRole("dialog", { name: /^Note for/ }));
};

describe("10.3 AC29 — Finish waits for notes", () => {
  it("disabled while a note is queued, with '1 note not saved yet' on its own line; enabled once it syncs", async () => {
    const { user, fake } = await setupNotes();
    goOffline(fake);
    const sheet = await openSheet(user, "Edit note for X");
    await user.type(sheet.getByLabelText("Note"), " more");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    expect(screen.getByText("1 note not saved yet")).toBeInTheDocument();
    expect(screen.queryByText(/sets? not saved yet/)).toBeNull();
    expect(screen.getByText("Offline — 1 note will save when you're back online")).toBeInTheDocument();
    goOnline(fake);
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled());
    expect(screen.queryByText(/not saved yet/)).toBeNull();
  });

  it("a failed note keeps Finish disabled until it is discarded", async () => {
    const { user, fake } = await setupNotes();
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(409, "workout-finished"));
    const sheet = await openSheet(user, "Edit note for X");
    await user.type(sheet.getByLabelText("Note"), "!");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("1 note couldn't be saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    await user.click(within(screen.getByTestId("sync-status")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled());
  });

  it("'Show' on a failed note scrolls to its card row", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { user, fake } = await setupNotes();
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(409, "workout-finished"));
    const sheet = await openSheet(user, "Edit note for X");
    await user.type(sheet.getByLabelText("Note"), "!");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    await screen.findByText("1 note couldn't be saved");
    await user.click(within(screen.getByTestId("sync-status")).getByRole("button", { name: "Show" }));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("a queue holding only set ops renders the exact 06.2 copy and states (regression)", async () => {
    const { user, fake } = await setupNotes();
    goOffline(fake);
    const field = within(screen.getByRole("article", { name: "X" })).getByLabelText("Reps");
    await user.clear(field);
    await user.type(field, "5");
    await user.click(within(screen.getByRole("article", { name: "X" })).getByRole("button", { name: "Log set" }));
    expect(screen.getByText("1 set not saved yet")).toBeInTheDocument();
    expect(screen.getByText("Offline — 1 set will save when you're back online")).toBeInTheDocument();
    // The cards carry a Note action, so scope the "no note wording" check to the status line and the bar hints.
    expect(within(screen.getByTestId("sync-status")).queryByText(/note/i)).toBeNull();
    expect(screen.queryByText(/notes? not saved yet/)).toBeNull();
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
  });
});

describe("10.3 AC30 — offline, reload, other user", () => {
  it("a note saved offline survives a reload and drains when the network returns", async () => {
    const { user, fake } = await setupNotes();
    goOffline(fake);
    const sheet = await openSheet(user, "Edit note for X");
    await user.clear(sheet.getByLabelText("Note"));
    await user.type(sheet.getByLabelText("Note"), "Survives reload");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(JSON.parse(localStorageAdapter().get(OUTBOX_KEY)!).ops).toEqual([expect.objectContaining({ kind: "note", body: { notes: "Survives reload" } })]);
    cleanup();
    // A reload: new React tree and query cache, same browser storage. The API is reachable again (the screen has to
    // read the workout), but the browser still reports offline (`online` stays false), so the outbox holds the note.
    fake.setOffline(false);
    onlineManager.setOnline(true);
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(await screen.findByText("Survives reload")).toBeInTheDocument();
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "PATCH")).toEqual([]);
    goOnline(fake);
    await waitFor(() => expect(fake.state.active!.exercises[0]!.notes).toBe("Survives reload"));
    await waitFor(() => expect(localStorageAdapter().get(OUTBOX_KEY)).toBeNull());
  });

  it("another user's outbox file is ignored: nothing is shown or sent", async () => {
    const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", notes: "Server text", sets: [makeSet({ setNumber: 1 })] }] }) });
    prepareApp({ auth, fake });
    const exerciseId = fake.state.active!.exercises[0]!.id;
    localStorageAdapter().set(
      OUTBOX_KEY,
      JSON.stringify({ v: 1, userId: "someone-else", idMap: {}, ops: [{ id: "x", kind: "note", workoutId: fake.state.active!.id, workoutExerciseId: exerciseId, userId: "someone-else", status: "queued", attempted: false, attempts: 0, nextAttemptAt: 0, enqueuedAt: 0, body: { notes: "THEIRS" } }] }),
    );
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(screen.getByText("Server text")).toBeInTheDocument();
    expect(screen.queryByText("THEIRS")).toBeNull();
    expect(fake.requests.filter((r) => r.method === "PATCH")).toEqual([]);
  });

  it("logout clears a queued note (the sin:workout: prefix)", async () => {
    const { user, fake } = await setupNotes();
    goOffline(fake);
    const sheet = await openSheet(user, "Edit note for X");
    await user.type(sheet.getByLabelText("Note"), "!");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(localStorageAdapter().get(OUTBOX_KEY)).not.toBeNull();
    clearUserData(localStorageAdapter());
    expect(localStorageAdapter().get(OUTBOX_KEY)).toBeNull();
  });

  it("a 409 workout-finished on a note op fails it with the 06.2 copy and no set_sync_failed event; Discard empties the outbox", async () => {
    const { user, fake } = await setupNotes();
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(409, "workout-finished"));
    const sheet = await openSheet(user, "Edit note for X");
    await user.type(sheet.getByLabelText("Note"), "!");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    const card = within(screen.getByRole("article", { name: "X" }));
    expect(await card.findByText("Couldn't save")).toBeInTheDocument();
    expect(observability.track).not.toHaveBeenCalledWith("set_sync_failed", expect.anything());
    await user.click(card.getByRole("button", { name: "Discard" }));
    expect(JSON.parse(localStorageAdapter().get(OUTBOX_KEY) ?? '{"ops":[]}').ops).toEqual([]);
  });
});

describe("10.3 AC37 — the note sheet", () => {
  it("the textarea is labeled, its count is a described hint, and an error is its own text — the count is never the only cue", async () => {
    const { user } = await setupNotes(null);
    const sheet = await openSheet(user, "Add note for X");
    const field = sheet.getByLabelText("Note");
    expect(field).toHaveAccessibleDescription("0 / 500");
    await user.click(field);
    await user.paste("a".repeat(501));
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(sheet.getByRole("alert")).toHaveTextContent("Keep notes to 500 characters");
    expect(field).toHaveAccessibleDescription(expect.stringContaining("501 / 500"));
  });
});
