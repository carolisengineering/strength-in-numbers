import { screen, waitFor, within } from "@testing-library/react";
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
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { makeCurrent } from "../../test/sessionHelpers";

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

const UNIQUE = "UNIQUE-note-text-7731";
const bodiesOf = (fake: Fake) => fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-exercises/")).map((r) => r.body);
const cardX = () => within(screen.getByRole("article", { name: "X" }));
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

describe("10.3 AC27 — the Note action and sheet", () => {
  it("every active card has one: 'Add note' when empty, 'Edit note' otherwise; the sheet is prefilled with a live count", async () => {
    const { user } = await setupNotes();
    await makeCurrent(user, "Y"); // Spec 17.1 AC9: only the current card mounts its Note action
    expect(screen.getByRole("button", { name: "Add note for Y" })).toHaveTextContent("Add note");
    await makeCurrent(user, "X");
    const sheet = await openSheet(user, "Edit note for X");
    expect(sheet.getByLabelText("Note")).toHaveValue("Pause every rep");
    expect(sheet.getByText("15 / 500")).toBeInTheDocument();
    await user.type(sheet.getByLabelText("Note"), "!");
    expect(sheet.getByText("16 / 500")).toBeInTheDocument();
  });

  it("Save trims, sends exactly { notes }, and the card shows the text; clearing sends notes: null and the label returns", async () => {
    const { user, fake } = await setupNotes(null);
    let sheet = await openSheet(user, "Add note for X");
    await user.type(sheet.getByLabelText("Note"), "  Left shoulder tight  ");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodiesOf(fake)).toEqual([{ notes: "Left shoulder tight" }]));
    expect(cardX().getByText("Left shoulder tight")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit note for X" })).toBeInTheDocument();
    sheet = await openSheet(user, "Edit note for X");
    await user.clear(sheet.getByLabelText("Note"));
    await user.click(sheet.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodiesOf(fake)).toEqual([{ notes: "Left shoulder tight" }, { notes: null }]));
    expect(screen.getByRole("button", { name: "Add note for X" })).toBeInTheDocument();
  });

  it("501 characters or a control character keeps the sheet open with the static message and sends nothing", async () => {
    const { user, fake } = await setupNotes(null);
    const sheet = await openSheet(user, "Add note for X");
    await user.click(sheet.getByLabelText("Note"));
    await user.paste("a".repeat(501));
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(sheet.getByText("Keep notes to 500 characters")).toBeInTheDocument();
    await user.clear(sheet.getByLabelText("Note"));
    await user.paste("bell\u0007");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(sheet.getByText("Keep notes to 500 characters")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /^Note for X/ })).toBeInTheDocument();
    expect(bodiesOf(fake)).toEqual([]);
  });

  it("Save on an unchanged value just closes: no request", async () => {
    const { user, fake } = await setupNotes();
    const sheet = await openSheet(user, "Edit note for X");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog", { name: /^Note for/ })).toBeNull();
    expect(bodiesOf(fake)).toEqual([]);
  });

  it("Cancel closes without a request; a finished workout has no Note action (covered in the summary suite)", async () => {
    const { user, fake } = await setupNotes();
    const sheet = await openSheet(user, "Edit note for X");
    await user.click(sheet.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: /^Note for/ })).toBeNull();
    expect(bodiesOf(fake)).toEqual([]);
  });
});

describe("10.3 AC28 — delivery", () => {
  it("offline: the sheet closes at once, the card shows the text with 'Not saved yet'; online: one PATCH, the tag clears and the text stays", async () => {
    const { user, fake } = await setupNotes();
    goOffline(fake);
    const sheet = await openSheet(user, "Edit note for X");
    await user.clear(sheet.getByLabelText("Note"));
    await user.type(sheet.getByLabelText("Note"), "Offline text");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog", { name: /^Note for/ })).toBeNull();
    expect(cardX().getByText("Offline text")).toBeInTheDocument();
    expect(cardX().getByText("Not saved yet")).toBeInTheDocument();
    goOnline(fake);
    await waitFor(() => expect(bodiesOf(fake)).toEqual([{ notes: "Offline text" }]));
    await waitFor(() => expect(cardX().queryByText("Not saved yet")).toBeNull());
    expect(cardX().getByText("Offline text")).toBeInTheDocument();
    expect(fake.state.active!.exercises[0]!.notes).toBe("Offline text");
  });

  it("two quick edits offline send one PATCH with the newer text", async () => {
    const { user, fake } = await setupNotes();
    goOffline(fake);
    for (const text of ["first", "second"]) {
      const sheet = await openSheet(user, "Edit note for X");
      await user.clear(sheet.getByLabelText("Note"));
      await user.type(sheet.getByLabelText("Note"), text);
      await user.click(sheet.getByRole("button", { name: "Save" }));
    }
    goOnline(fake);
    await waitFor(() => expect(bodiesOf(fake)).toEqual([{ notes: "second" }]));
  });

  it("a note that failed shows 'Couldn't save' and Discard; Discard puts the server's text back", async () => {
    const { user, fake } = await setupNotes();
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(409, "workout-finished"));
    const sheet = await openSheet(user, "Edit note for X");
    await user.clear(sheet.getByLabelText("Note"));
    await user.type(sheet.getByLabelText("Note"), "Will fail");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(await cardX().findByText("Couldn't save")).toBeInTheDocument();
    expect(cardX().getByText("Will fail")).toBeInTheDocument();
    await user.click(cardX().getByRole("button", { name: /^Discard note / }));
    await waitFor(() => expect(cardX().getByText("Pause every rep")).toBeInTheDocument());
    expect(observability.track.mock.calls.some(([name]) => String(name).startsWith("set_sync"))).toBe(false);
  });

  it("a regroup never carries notes: link two cards, every PATCH body is position / supersetGroup only", async () => {
    const { user, fake } = await setupNotes();
    await user.click(screen.getByRole("button", { name: "Superset X with Y" }));
    await waitFor(() => expect(bodiesOf(fake).length).toBeGreaterThan(0));
    for (const body of bodiesOf(fake)) expect(Object.keys(body as object).every((k) => k === "position" || k === "supersetGroup")).toBe(true);
  });
});

describe("10.3 AC35 — a note reaches no analytics or error call", () => {
  it("saving and syncing a note: no track, no reportError, no console argument carries the text", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m));
    const { user, fake } = await setupNotes(null);
    const sheet = await openSheet(user, "Add note for X");
    await user.type(sheet.getByLabelText("Note"), UNIQUE);
    await user.click(sheet.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodiesOf(fake)).toHaveLength(1));
    expect(observability.track.mock.calls.filter(([name]) => String(name).startsWith("set_"))).toEqual([]);
    expect(JSON.stringify([observability.track.mock.calls, observability.reportError.mock.calls, spies.map((s) => s.mock.calls)])).not.toContain(UNIQUE);
    for (const spy of spies) spy.mockRestore();
  });
});

describe("10.3 AC36 — exercise notes are text", () => {
  it("markup in a note renders as text and creates no element", async () => {
    const { user } = await setupNotes(null);
    const sheet = await openSheet(user, "Add note for X");
    await user.click(sheet.getByLabelText("Note"));
    await user.paste("<img src=x onerror=alert(1)>");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(await cardX().findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
