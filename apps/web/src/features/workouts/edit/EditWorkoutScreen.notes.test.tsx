import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";
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
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../../test/workoutHarness";
import { card } from "../../../test/sessionHelpers";
import { EDIT_COPY } from "./editCopy";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

async function open(notes: string | null = null) {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "Bench Press", notes, sets: [makeSet({ setNumber: 1 })] }],
  });
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake });
  const app = renderApp(`/app/history/${workout.id}/edit`);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  return { fake, workout, ...app };
}
const patches = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "PATCH");
const sheet = () => within(screen.getByRole("dialog", { name: "Note for Bench Press" }));

async function typeNote(user: Awaited<ReturnType<typeof open>>["user"], text: string, button = "Add note for Bench Press") {
  await user.click(screen.getByRole("button", { name: button }));
  const field = sheet().getByLabelText("Note");
  await user.clear(field);
  await user.type(field, text);
  await user.click(sheet().getByRole("button", { name: "Save" }));
}

describe("18.0 AC12 — exercise notes wait for the server", () => {
  it("Save is busy while the PATCH is held; the body is exactly { notes }; it closes on 200 and the card shows the note", async () => {
    const { fake, workout, user } = await open();
    const held = deferred<void>();
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, (async () => {
      await held.promise;
      return HttpResponse.json({ ...workout.exercises[0]!, sets: undefined, notes: "Slow eccentric", updatedAt: new Date().toISOString() });
    }) as unknown as () => Response);
    await typeNote(user, "Slow eccentric");
    await waitFor(() => expect(sheet().getByRole("button", { name: "Save" })).toHaveAttribute("aria-busy", "true"));
    await user.click(sheet().getByRole("button", { name: "Save" }));
    held.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for Bench Press" })).toBeNull());
    expect(patches(fake).map((r) => r.body)).toEqual([{ notes: "Slow eccentric" }]);
    expect(within(card("Bench Press")).getByText("Slow eccentric")).toBeInTheDocument();
    expect(screen.getByTestId("edit-announcement")).toHaveTextContent("Note saved");
  });

  it("an unchanged note closes with no request", async () => {
    const { fake, user } = await open("Pause");
    await user.click(screen.getByRole("button", { name: "Edit note for Bench Press" }));
    await user.click(sheet().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for Bench Press" })).toBeNull());
    expect(patches(fake)).toEqual([]);
  });

  it("offline: the sheet stays open with the typed text and the offline copy", async () => {
    const { fake, user } = await open();
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => HttpResponse.error());
    await typeNote(user, "Slow eccentric");
    await waitFor(() => expect(sheet().getByText(EDIT_COPY.offline)).toBeInTheDocument());
    expect(sheet().getByLabelText("Note")).toHaveValue("Slow eccentric");
  });

  it("DM-12 — a save in flight keeps the sheet open: Cancel, Close and Escape wait, and a failure shows in the sheet", async () => {
    const { fake, user } = await open();
    const held = deferred<void>();
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, (async () => {
      await held.promise;
      return problemResponse(500, "about:blank");
    }) as unknown as () => Response);
    await typeNote(user, "Slow eccentric");
    await user.click(sheet().getByRole("button", { name: "Cancel" }));
    await user.click(sheet().getByRole("button", { name: "Close" }));
    fireEvent(screen.getByRole("dialog", { name: "Note for Bench Press" }), new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog", { name: "Note for Bench Press" })).toBeInTheDocument();
    held.resolve();
    await waitFor(() => expect(sheet().getByText("Couldn't save the note — try again")).toBeInTheDocument());
    await user.click(sheet().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for Bench Press" })).toBeNull());
  });

  it("a 500 says the note couldn't be saved", async () => {
    const { fake, user } = await open();
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(500, "about:blank"));
    await typeNote(user, "Slow eccentric");
    await waitFor(() => expect(sheet().getByText("Couldn't save the note — try again")).toBeInTheDocument());
  });

  it("a 404 closes the sheet and the banner says the exercise was removed", async () => {
    const { fake, user } = await open();
    fake.failNext({ method: "PATCH", path: /\/workout-exercises\// }, () => problemResponse(404, "not-found"));
    await typeNote(user, "Slow eccentric");
    expect(await screen.findByText(EDIT_COPY.exerciseMissing)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Note for Bench Press" })).toBeNull();
  });
});
