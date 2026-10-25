import { screen, waitFor, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
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

function openOneSet(section: "workouts" | "history" = "history") {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }],
  });
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake });
  const app = renderApp(`/app/${section}/${workout.id}/edit`);
  return { fake, workout, ...app };
}
const dialog = () => screen.getByRole("dialog", { name: EDIT_COPY.lastSet.title });

async function deleteOnlySet(user: ReturnType<typeof openOneSet>["user"]) {
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  await user.click(within(card("Bench Press")).getByRole("button", { name: /60 kg × 8/ }));
  await user.click(within(screen.getByRole("dialog", { name: /^Set 1/ })).getByRole("button", { name: "Delete set" }));
  await waitFor(() => expect(dialog()).toBeInTheDocument());
}

describe("18.0 AC18 — 409 workout-would-be-empty opens the dialog", () => {
  it("the server is asked (no pre-check); the dialog shows the pinned copy with focus on Keep it", async () => {
    const { fake, user } = openOneSet();
    await deleteOnlySet(user);
    expect(fake.requests.filter((r) => r.method === "DELETE" && r.path.startsWith("/v1/sets/"))).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: /^Set 1/ })).toBeNull();
    expect(dialog()).toHaveTextContent(EDIT_COPY.lastSet.body);
    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Keep it" }));
  });

  it("Keep it closes the dialog; the row is unchanged; the refusal is tracked as kept", async () => {
    const { user } = openOneSet();
    await deleteOnlySet(user);
    await user.click(within(dialog()).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: EDIT_COPY.lastSet.title })).toBeNull());
    expect(within(card("Bench Press")).getByRole("button", { name: /60 kg × 8/ })).toBeInTheDocument();
    expect(observability.track).toHaveBeenCalledWith("workout_edit_refused", { reason: "would_be_empty", choice: "kept" });
  });
});

describe("18.0 AC19 — Delete workout", () => {
  it.each([
    ["history", "/app/history"],
    ["workouts", "/app/workouts"],
  ] as const)("from /app/%s/:id/edit: DELETE the workout, land on %s (replace), tracked as deleted", async (section, home) => {
    const { fake, workout, user, router } = openOneSet(section);
    await deleteOnlySet(user);
    await user.click(within(dialog()).getByRole("button", { name: "Delete workout" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(home));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(fake.requests.some((r) => r.method === "DELETE" && r.path === `/v1/workouts/${workout.id}`)).toBe(true);
    expect(fake.state.finished.has(workout.id)).toBe(false);
    expect(observability.track).toHaveBeenCalledWith("workout_edit_refused", { reason: "would_be_empty", choice: "deleted" });
  });

  it("#160 — once the delete starts the detail is never read again (a focus mid-delete included); no NotFound flash", async () => {
    const { fake, workout, user, router } = openOneSet();
    await deleteOnlySet(user);
    const held = deferred<void>();
    fake.failNext({ method: "DELETE", path: /^\/v1\/workouts\// }, (async () => {
      await held.promise;
      return new Response(null, { status: 204 });
    }) as unknown as () => Response);
    await user.click(within(dialog()).getByRole("button", { name: "Delete workout" }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === "DELETE" && r.path === `/v1/workouts/${workout.id}`)).toBe(true));
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    held.resolve();
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
    focusManager.setFocused(undefined);
    const deleteAt = fake.requests.findIndex((r) => r.method === "DELETE" && r.path === `/v1/workouts/${workout.id}`);
    expect(fake.requests.slice(deleteAt).filter((r) => r.method === "GET" && r.path === `/v1/workouts/${workout.id}`)).toEqual([]);
    expect(screen.queryByRole("heading", { name: /not found/i })).toBeNull();
  });

  it("a 404 counts as done", async () => {
    const { fake, user, router } = openOneSet();
    await deleteOnlySet(user);
    fake.failNext({ method: "DELETE", path: /^\/v1\/workouts\// }, () => problemResponse(404, "not-found"));
    await user.click(within(dialog()).getByRole("button", { name: "Delete workout" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
  });

  it("a 500 closes the dialog and shows the banner with Try again, which re-sends", async () => {
    const { fake, workout, user, router } = openOneSet();
    await deleteOnlySet(user);
    fake.failNext({ method: "DELETE", path: /^\/v1\/workouts\// }, () => problemResponse(500, "about:blank"));
    await user.click(within(dialog()).getByRole("button", { name: "Delete workout" }));
    expect(await screen.findByText(EDIT_COPY.deleteFailed)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: EDIT_COPY.lastSet.title })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
    expect(fake.requests.filter((r) => r.method === "DELETE" && r.path === `/v1/workouts/${workout.id}`)).toHaveLength(2);
  });
});
