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

import { onlineManager } from "@tanstack/react-query";
import { localStorageAdapter } from "../../storage/storage";
import { card, logButton, makeCurrent } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { DRAFTS_KEY } from "./drafts/draftStore";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  cleanupApp();
});

async function setup() {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }, { modality: "weight_reps", name: "Y" }] }),
  });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

describe("17.1 AC34 — offline logging still queues, and collapsed rows say so", () => {
  it("a queued set shows 'Not saved yet' on the row and on the collapsed card; Finish waits", async () => {
    const { fake, user } = await setup();
    online = false;
    fake.setOffline(true);
    window.dispatchEvent(new Event("offline"));
    await user.click(logButton("X"));
    expect(await within(card("X")).findByText("Not saved yet")).toBeInTheDocument();
    await makeCurrent(user, "Y");
    expect(within(card("X")).getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish workout" })).toBeDisabled();
  });
});

describe("17.1 AC35 — drafts and re-seed survive the new screen", () => {
  it("an edited draft is stored, restored on re-expand, and cleared by a log", async () => {
    const { user } = await setup();
    const reps = within(card("X")).getByLabelText("Reps");
    await user.clear(reps);
    await user.type(reps, "9");
    await waitFor(() => expect(localStorageAdapter().get(DRAFTS_KEY)).not.toBeNull());
    await makeCurrent(user, "Y");
    await makeCurrent(user, "X");
    expect(within(card("X")).getByLabelText("Reps")).toHaveValue("9");
    await user.click(logButton("X"));
    await waitFor(() => expect(localStorageAdapter().get(DRAFTS_KEY)).toBeNull());
  });
});

describe("17.1 AC37 — notes on the current card", () => {
  it("Add note works on the current card and is queued as a note op", async () => {
    const { fake, user } = await setup();
    await user.click(within(card("X")).getByRole("button", { name: "Add note for X" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByRole("textbox"), "Pause");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === "PATCH" && /workout-exercises/.test(r.path))).toBe(true));
  });
});
