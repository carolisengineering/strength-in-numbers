import { screen, waitFor } from "@testing-library/react";
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
import type { SectionTimer, WorkoutDetail } from "@sin/core";
import { localStorageAdapter } from "../../storage/storage";
import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { OUTBOX_KEY } from "./outbox/outbox";
import { unsavedTimerEntries } from "./outbox/ops";
import { WORKOUT_KEYS } from "./queries";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

type Seed = { round: number; seconds: number | null } | { result: Record<string, unknown> | null };
let seq = 0;
/** Queued, never-sent timer entries for one section, as a reloaded tab would find them. */
function seedSectionOps(workoutId: string, sectionId: string, entries: Seed[]) {
  localStorageAdapter().set(
    OUTBOX_KEY,
    JSON.stringify({
      v: 1,
      userId: USER_ID,
      idMap: {},
      ops: entries.map((e) => ({
        id: `seed-${++seq}`,
        workoutId,
        userId: USER_ID,
        status: "queued",
        attempted: false,
        attempts: 0,
        nextAttemptAt: 0,
        enqueuedAt: 0,
        sectionId,
        ...("round" in e ? { kind: "round", round: e.round, body: { seconds: e.seconds } } : { kind: "result", body: e.result }),
      })),
    }),
  );
}
const storedOps = () => JSON.parse(localStorageAdapter().get(OUTBOX_KEY) ?? '{"ops":[]}').ops as { kind: string; status: string }[];
const AMRAP12: SectionTimer = { format: "amrap", capSeconds: 720 };

async function boot(timer: SectionTimer | null, roundTimes: { round: number; seconds: number }[], entries: (w: WorkoutDetail) => [string, Seed[]]) {
  const active = makeWorkoutDetail({ sections: [{ name: "Finisher", timer, roundTimes }], exercises: [{ modality: "weight_reps", name: "Burpee", sectionIndex: 0 }] });
  const fake = createWorkoutFake({ active });
  prepareApp({ auth, fake });
  const [sectionId, seeds] = entries(active);
  seedSectionOps(active.id, sectionId, seeds);
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, active, ...app };
}
const cachedSection = (qc: Awaited<ReturnType<typeof boot>>["queryClient"]) => qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)!.sections[0]!;

describe("10.7 AC37 — cache after sync", () => {
  it("after a round PUT syncs, the active cache holds the server's section", async () => {
    const { fake, queryClient } = await boot(AMRAP12, [{ round: 1, seconds: 250 }], (w) => [w.sections[0]!.id, [{ round: 2, seconds: 515 }]]);
    await waitFor(() => expect(storedOps()).toEqual([]));
    expect(fake.state.active!.sections[0]!.roundTimes).toEqual([{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }]);
    await waitFor(() => expect(cachedSection(queryClient).roundTimes).toEqual([{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }]));
  });

  it("after a round DELETE syncs, the round is gone from the cache", async () => {
    const { queryClient } = await boot(AMRAP12, [{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }], (w) => [w.sections[0]!.id, [{ round: 2, seconds: null }]]);
    await waitFor(() => expect(storedOps()).toEqual([]));
    await waitFor(() => expect(cachedSection(queryClient).roundTimes).toEqual([{ round: 1, seconds: 250 }]));
  });

  it("a 404 (the section was removed on another device) is done: the active workout is re-read and nothing is left unsaved (Review Focus 3)", async () => {
    const { fake, active } = await boot(AMRAP12, [], () => ["00000000-0000-4000-8000-0000000000aa", [{ round: 1, seconds: 250 }]]);
    const reads = () => fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;
    await waitFor(() => expect(storedOps()).toEqual([]));
    await waitFor(() => expect(reads()).toBeGreaterThan(1));
    expect(unsavedTimerEntries([], active.id)).toEqual({ pending: 0, failed: 0 });
  });

  it("a 409 section-timer-mismatch (the timer was removed on another device) fails the op and reports only log-result (Review Focus 4)", async () => {
    await boot(null, [], (w) => [w.sections[0]!.id, [{ round: 1, seconds: 250 }]]);
    await waitFor(() => expect(storedOps()).toEqual([expect.objectContaining({ kind: "round", status: "failed" })]));
    expect(observability.track).toHaveBeenCalledWith("set_sync_failed", { status: 409 });
    const reported = JSON.stringify(observability.reportError.mock.calls);
    for (const call of observability.reportError.mock.calls) expect(call[1]).toEqual({ source: "workouts", op: "log-result" });
    expect(reported).not.toMatch(/250|Finisher/);
  });
});

describe("10.7 AC41 — delivery twice is the same as once", () => {
  const put = (path: string, body: unknown) =>
    fetch(`${API_BASE_URL}/v1${path}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("shifting every AMRAP reading later in one Save drains with no 422, and re-sending each op leaves the same state (Review Focus 2)", async () => {
    // The order orderRoundWrites gives for a shift upward: highest round first. A 15:00 limit, so 13:20 is inside it.
    const { fake } = await boot({ format: "amrap", capSeconds: 900 }, [{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }, { round: 3, seconds: 770 }], (w) => [
      w.sections[0]!.id,
      [{ round: 3, seconds: 800 }, { round: 2, seconds: 545 }, { round: 1, seconds: 280 }, { result: { rounds: 5, reps: 7 } }],
    ]);
    await waitFor(() => expect(storedOps()).toEqual([]));
    const section = () => fake.state.active!.sections[0]!;
    expect(section().roundTimes).toEqual([{ round: 1, seconds: 280 }, { round: 2, seconds: 545 }, { round: 3, seconds: 800 }]);
    const once = structuredClone(section());
    const id = once.id;
    for (const [r, s] of [[3, 800], [2, 545], [1, 280]] as const) expect((await put(`/workout-sections/${id}/round-times/${r}`, { seconds: s })).status).toBe(200);
    expect((await put(`/workout-sections/${id}/result`, { rounds: 5, reps: 7 })).status).toBe(200);
    expect(section()).toEqual(once);
  });

  it("a Set Timer edit with a clear between two rounds drains and replays the same way", async () => {
    const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
    const { fake } = await boot(SET5, [{ round: 1, seconds: 221 }, { round: 2, seconds: 218 }], (w) => [
      w.sections[0]!.id,
      [{ round: 1, seconds: 200 }, { round: 2, seconds: null }, { round: 3, seconds: 210 }],
    ]);
    await waitFor(() => expect(storedOps()).toEqual([]));
    const section = () => fake.state.active!.sections[0]!;
    expect(section().roundTimes).toEqual([{ round: 1, seconds: 200 }, { round: 3, seconds: 210 }]);
    const once = structuredClone(section());
    expect((await put(`/workout-sections/${once.id}/round-times/1`, { seconds: 200 })).status).toBe(200);
    expect((await fetch(`${API_BASE_URL}/v1/workout-sections/${once.id}/round-times/2`, { method: "DELETE" })).status).toBe(204);
    expect((await put(`/workout-sections/${once.id}/round-times/3`, { seconds: 210 })).status).toBe(200);
    expect(section()).toEqual(once);
  });
});
