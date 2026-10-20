import { screen, waitFor, within } from "@testing-library/react";
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

import type { WorkoutDetail } from "@sin/core";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../../test/workoutHarness";
import { editDoneButton } from "../../../test/sessionHelpers";
import { WORKOUT_KEYS } from "../queries";
import { EDIT_COPY } from "./editCopy";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;

async function open(details: { title?: string | null; notes?: string | null } = {}) {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1 })] }],
    ...details,
  });
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake });
  const app = renderApp(`/app/history/${workout.id}/edit`);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  return { fake, workout, ...app };
}
const panel = () => within(screen.getByRole("region", { name: "Details" }));
const sheet = () => within(screen.getByRole("dialog", { name: "Details" }));
const patches = (fake: Fake) => fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workouts/"));
const TITLE = "Heavy bench day"; // 15 characters
const NOTES = "Shoulder felt tight on set 3.\nX"; // 31 characters

async function edit(user: Awaited<ReturnType<typeof open>>["user"], field: "Title" | "Notes", text: string) {
  await user.click(panel().getByRole("button", { name: "Edit details" }));
  const input = sheet().getByLabelText(field);
  await user.clear(input);
  if (text !== "") await user.type(input, text);
}

describe("18.0 AC52 — the Details panel", () => {
  it("empty: No title / No notes and an Edit details button", async () => {
    await open();
    expect(panel().getByRole("heading", { level: 2, name: "Details" })).toBeInTheDocument();
    expect(panel().getByText("No title")).toBeInTheDocument();
    expect(panel().getByText("No notes")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Edit details" }).className).toMatch(/_secondary_/);
  });

  it("set: the values, the notes pre-wrapped", async () => {
    await open({ title: TITLE, notes: NOTES });
    expect(panel().getByText(TITLE)).toBeInTheDocument();
    expect(panel().getByText((_, el) => el?.tagName === "P" && el.textContent === NOTES)).toBeInTheDocument();
  });
});

describe("18.0 AC53 / AC54 — the Details sheet", () => {
  it("prefilled with counting hints", async () => {
    const { user } = await open({ title: "Heavy bench da", notes: NOTES });
    await user.click(panel().getByRole("button", { name: "Edit details" }));
    expect(sheet().getByLabelText("Title")).toHaveValue("Heavy bench da");
    expect(sheet().getByText("14 / 120")).toBeInTheDocument();
    expect(sheet().getByText("31 / 4000")).toBeInTheDocument();
  });

  it("a 121-character title shows the error and sends nothing", async () => {
    const { fake, user } = await open();
    await edit(user, "Title", "x".repeat(121));
    await user.click(sheet().getByRole("button", { name: "Save details" }));
    expect(sheet().getByText("Title can be at most 120 characters.")).toBeInTheDocument();
    expect(patches(fake)).toEqual([]);
  });

  it("Save sends only the changed key; on 200 the sheet closes, the panel and the cache show it, Details saved is spoken", async () => {
    const { fake, workout, user, queryClient } = await open({ title: TITLE, notes: NOTES });
    await edit(user, "Title", "Deload");
    await user.click(sheet().getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull());
    expect(patches(fake).map((r) => r.body)).toEqual([{ title: "Deload" }]);
    expect(panel().getByText("Deload")).toBeInTheDocument();
    expect(queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workout.id))!.title).toBe("Deload");
    expect(screen.getByTestId("edit-announcement")).toHaveTextContent("Details saved");
    expect(observability.track).toHaveBeenCalledWith("workout_edit", { edit: "details_changed" });
  });

  it.each([
    ["offline", () => HttpResponse.error(), EDIT_COPY.offline],
    ["500", () => problemResponse(500, "about:blank"), "Couldn't save the details — try again"],
    ["422", () => problemResponse(422, "validation-error", { errors: [{ path: "title", message: "Test problem" }] }), "Check the details and try again."],
  ] as const)("%s: the sheet stays open with the typed text and the copy; never the server's message", async (_name, response, copy) => {
    const { fake, user } = await open();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\// }, response);
    await edit(user, "Title", "Deload");
    await user.click(sheet().getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(sheet().getByText(copy)).toBeInTheDocument());
    expect(sheet().getByLabelText("Title")).toHaveValue("Deload");
    expect(screen.queryByText("Test problem")).toBeNull();
  });

  it("404: the vanished view", async () => {
    const { fake, user } = await open();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\// }, () => problemResponse(404, "not-found"));
    await edit(user, "Title", "Deload");
    await user.click(sheet().getByRole("button", { name: "Save details" }));
    expect(await screen.findByText(EDIT_COPY.vanished)).toBeInTheDocument();
  });

  it("a double tap sends one request", async () => {
    const { fake, user } = await open();
    const held = deferred<void>();
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\// }, (async () => {
      await held.promise;
      return problemResponse(500, "about:blank");
    }) as unknown as () => Response);
    await edit(user, "Title", "Deload");
    const save = sheet().getByRole("button", { name: "Save details" });
    await user.click(save);
    await user.click(save);
    held.resolve();
    await waitFor(() => expect(sheet().getByText("Couldn't save the details — try again")).toBeInTheDocument());
    expect(patches(fake)).toHaveLength(1);
  });
});

describe("18.0 AC55 — round trip", () => {
  it("set a title and two-line notes, Done shows both; clear the title, the body is { title: null } and the notes stay", async () => {
    const { fake, user } = await open();
    await user.click(panel().getByRole("button", { name: "Edit details" }));
    await user.type(sheet().getByLabelText("Title"), TITLE);
    await user.type(sheet().getByLabelText("Notes"), "Line one{Enter}Line two");
    await user.click(sheet().getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull());
    await user.click(editDoneButton());
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    const notes = screen.getByRole("region", { name: "Workout notes" });
    expect(notes).toHaveTextContent("Line one");
    expect([...notes.querySelectorAll("p")].some((p) => p.textContent === "Line one\nLine two")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Edit workout" }));
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    await edit(user, "Title", "");
    await user.click(sheet().getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull());
    expect(patches(fake).at(-1)!.body).toEqual({ title: null });
    await user.click(editDoneButton());
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.getByRole("region", { name: "Workout notes" })).toHaveTextContent("Line two");
  });
});
