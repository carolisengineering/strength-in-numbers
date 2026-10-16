import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { localStorageAdapter, memoryStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { createWorkoutFake } from "../../test/workoutFake";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { cleanupApp, deferred, fakeClient, makeQueryClient, prepareApp, renderApp } from "../../test/workoutHarness";
import { DRAFTS_KEY, DRAFT_DEBOUNCE_MS, createDraftStores } from "./drafts/draftStore";
import { DraftStoresContext } from "./drafts/DraftStoreContext";
import { EntryRow } from "./EntryRow";
import { WorkoutClientContext } from "./queries";

afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanup();
  cleanupApp();
});

const bench = (o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
  modality: "weight_reps",
  name: "Bench",
  sets: [makeSet({ setNumber: 1, reps: 8, weight: 80 })],
  ...o,
});
async function setup(exercises: ExerciseSpec[] = [bench()]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const card = () => screen.getByRole("article", { name: "Bench" });
const field = (label: string) => within(card()).getByLabelText(label);
const storage = localStorageAdapter();
const storedDrafts = () => {
  const raw = storage.get(DRAFTS_KEY);
  return raw === null ? null : JSON.parse(raw);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const typeInto = async (user: ReturnType<typeof userEvent.setup>, label: string, value: string) => {
  await user.clear(field(label));
  await user.type(field(label), value);
};

describe("06.5 AC6 — only an edited draft is persisted", () => {
  it("an untouched row writes nothing, even after the debounce", async () => {
    await setup();
    await wait(DRAFT_DEBOUNCE_MS + 100);
    expect(storedDrafts()).toBeNull();
  });

  it("one edit is written after the debounce", async () => {
    const { user } = await setup();
    await typeInto(user, "Reps", "11");
    await waitFor(() => expect(storedDrafts()?.byExercise).toBeDefined());
    const [entry] = Object.values(storedDrafts().byExercise) as { reps: string }[];
    expect(entry!.reps).toBe("11");
    expect(storedDrafts().userId).toBe(USER_ID);
  });
});

describe("06.5 AC7 — a remounted card restores an edited draft", () => {
  it("shows the typed values after a reload, with a fresh attemptKey", async () => {
    const { user } = await setup();
    await typeInto(user, "Weight", "62.5");
    await typeInto(user, "Reps", "7");
    cleanup(); // unmount flushes the pending write; storage is untouched
    const spy = vi.spyOn(crypto, "randomUUID");
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(field("Weight")).toHaveValue("62.5");
    expect(field("Reps")).toHaveValue("7");
    expect(spy).toHaveBeenCalled(); // the restored draft got a freshly minted attemptKey
    spy.mockRestore();
  });
});

describe("06.5 AC8 — a restored draft is never overwritten by a re-seed", () => {
  it("deleting a logged set from the edit sheet leaves the restored values alone", async () => {
    const { user } = await setup([bench({ sets: [makeSet({ setNumber: 1, reps: 10, weight: 60 }), makeSet({ setNumber: 2, reps: 8, weight: 80 })] })]);
    await typeInto(user, "Reps", "99");
    cleanup();
    const again = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    await again.user.click(within(card()).getByRole("button", { name: /80 kg × 8/ }));
    await again.user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(within(card()).queryByRole("button", { name: /80 kg × 8/ })).not.toBeInTheDocument());
    expect(field("Reps")).toHaveValue("99");
  });
});

describe("06.5 AC9 — logging clears the stored draft; typing after the tap keeps it", () => {
  it("log with no further typing removes the entry and the key", async () => {
    const { user } = await setup();
    await typeInto(user, "Reps", "9");
    await waitFor(() => expect(storedDrafts()).not.toBeNull());
    await user.click(within(card()).getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(storedDrafts()).toBeNull());
  });

  it("typing between the tap and the response keeps the draft with the newer values", async () => {
    const memory = memoryStorageAdapter();
    const stores = createDraftStores(memory, USER_ID);
    const detail = makeWorkoutDetail({ exercises: [bench()] });
    const exercise = detail.exercises[0]!;
    const response = deferred<ReturnType<typeof makeSet>>();
    const client = fakeClient({ createSet: () => response.promise as never });
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <WorkoutClientContext.Provider value={client}>
          <DraftStoresContext.Provider value={stores}>
            <EntryRow exercise={exercise} unitPreference="kg" onGone={() => {}} />
          </DraftStoresContext.Provider>
        </WorkoutClientContext.Provider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const reps = screen.getByLabelText("Reps");
    await user.clear(reps);
    await user.type(reps, "9");
    await user.click(screen.getByRole("button", { name: "Log set" }));
    await user.clear(reps); // the lifter is already entering the next set
    await user.type(reps, "6");
    response.resolve(makeSet({ setNumber: 2, reps: 9, weight: 80 }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Set 2 logged"));
    stores.flushAll();
    const stored = JSON.parse(memory.get(DRAFTS_KEY)!);
    expect(stored.byExercise[exercise.id].reps).toBe("6");
  });
});

describe("06.5 AC11 — drafts survive a reload but not a different workout", () => {
  it("a value stored for another workout is dropped and not restored", async () => {
    storage.set(
      DRAFTS_KEY,
      JSON.stringify({
        v: 1,
        userId: USER_ID,
        workoutId: "some-old-workout",
        byExercise: { x: { weight: "1", reps: "1", distance: "", minutes: "", seconds: "", rpe: "", weightUnit: "kg", distanceUnit: "km", setType: "working" } },
      }),
    );
    await setup();
    expect(field("Reps")).toHaveValue("8"); // seeded from the last set, not "1"
    expect(storedDrafts()).toBeNull();
  });
});
