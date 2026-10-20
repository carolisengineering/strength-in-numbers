import { act, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
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

import { localStorageAdapter } from "../../../storage/storage";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { card, logButton } from "../../../test/sessionHelpers";
import { DRAFTS_KEY } from "../drafts/draftStore";
import { OUTBOX_KEY } from "../outbox/outbox";
import { WORKOUT_KEYS } from "../queries";
import { REST_KEY } from "../restStore";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  cleanupApp();
});

const planned = (n: number) => Array.from({ length: n }, () => ({ setType: "working" as const, repsLow: 5, repsHigh: 5, weight: 60, weightUnit: "kg" as const }));

describe("18.0 AC21 — edit mode never touches the live session", () => {
  it("a queued op, a stored draft and a running rest timer are byte-equal after an edit; the active cache is the same object", async () => {
    const live = makeWorkoutDetail({
      exercises: [{ modality: "weight_reps", name: "Squat", restSeconds: 90, plannedSets: planned(3), sets: [makeSet({ setNumber: 1, weight: 60, reps: 5 })] }],
    });
    const finished = makeWorkoutDetail({
      endedAt: "2026-10-01T11:00:00.000Z",
      localDate: "2026-10-01",
      exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1, weight: 80, reps: 5 }), makeSet({ setNumber: 2, weight: 80, reps: 5 })] }],
    });
    const fake = createWorkoutFake({ active: live, finished: [finished] });
    prepareApp({ auth, fake });
    const { user, router, queryClient } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });

    // Offline in the browser's view (the fake stays reachable): the log is queued, not sent.
    online = false;
    window.dispatchEvent(new Event("offline"));
    await user.click(logButton("Squat"));
    await waitFor(() => expect(localStorageAdapter().get(OUTBOX_KEY)).not.toBeNull());
    await waitFor(() => expect(localStorageAdapter().get(REST_KEY)).not.toBeNull());
    const reps = within(card("Squat")).getByLabelText("Reps");
    await user.clear(reps);
    await user.type(reps, "7");
    await waitFor(() => expect(localStorageAdapter().get(DRAFTS_KEY)).not.toBeNull());

    // TanStack paused its queries on the `offline` event; the outbox still sees the browser as offline.
    act(() => onlineManager.setOnline(true));
    await act(() => router.navigate(`/app/history/${finished.id}/edit`));
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    const before = [OUTBOX_KEY, DRAFTS_KEY, REST_KEY].map((k) => localStorageAdapter().get(k));
    const active = queryClient.getQueryData(WORKOUT_KEYS.active);

    await user.click(within(card("Bench Press")).getByRole("button", { name: /^2/ }));
    const sheet = within(screen.getByRole("dialog", { name: /^Set 2/ }));
    await user.clear(sheet.getByLabelText("Reps"));
    await user.type(sheet.getByLabelText("Reps"), "6");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Set 2/ })).toBeNull());

    expect([OUTBOX_KEY, DRAFTS_KEY, REST_KEY].map((k) => localStorageAdapter().get(k))).toEqual(before);
    expect(queryClient.getQueryData(WORKOUT_KEYS.active)).toBe(active);
    expect(fake.requests.filter((r) => r.method === "PATCH").map((r) => r.path)).toEqual([`/v1/sets/${finished.exercises[0]!.sets[1]!.id}`]);
    expect(fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"))).toEqual([]);
  });
});
