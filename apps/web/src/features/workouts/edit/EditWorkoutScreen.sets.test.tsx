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
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../../test/workoutHarness";
import { addSetButton, card, editDoneButton } from "../../../test/sessionHelpers";
import { WORKOUT_KEYS } from "../queries";
import { EDIT_COPY } from "./editCopy";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;

const bench = (): ExerciseSpec => ({
  modality: "weight_reps",
  name: "Bench Press",
  sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 }), makeSet({ setNumber: 2, weight: 80, reps: 5 })],
});

function open(exercises: ExerciseSpec[] = [bench()], opts: { unitPreference?: "kg" | "lb" } = {}) {
  const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises });
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake, unitPreference: opts.unitPreference ?? "kg" });
  const app = renderApp(`/app/history/${workout.id}/edit`);
  return { fake, workout, ...app };
}
const ready = () => screen.findByRole("heading", { level: 1, name: "Edit workout" });
const sheet = (name: RegExp | string) => within(screen.getByRole("dialog", { name }));
const announcement = () => screen.getByTestId("edit-announcement");
const writes = (fake: Fake) => fake.requests.filter((r) => r.method !== "GET");
const stored = (fake: Fake, id: string) => fake.state.finished.get(id)!;

async function openSet(user: ReturnType<typeof open>["user"], text: RegExp) {
  await user.click(within(card("Bench Press")).getByRole("button", { name: text }));
}

describe("18.0 AC6 — edit a set", () => {
  it("Save sends only the changed key; the row updates, the sheet closes and the status line speaks", async () => {
    const { fake, workout, user } = open();
    await ready();
    await openSet(user, /80 kg × 5/);
    const s = sheet(/^Set 2 · Bench Press/);
    await user.clear(s.getByLabelText("Reps"));
    await user.type(s.getByLabelText("Reps"), "6");
    await user.click(s.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes(fake).map((r) => [r.method, r.body])).toEqual([["PATCH", { reps: 6 }]]);
    expect(within(card("Bench Press")).getByRole("button", { name: /80 kg × 6/ })).toBeInTheDocument();
    expect(announcement()).toHaveTextContent("Set 2 saved");
    expect(stored(fake, workout.id).exercises[0]!.sets[1]!.reps).toBe(6);
  });

  it("no change → no request; the sheet closes", async () => {
    const { fake, user } = open();
    await ready();
    await openSet(user, /80 kg × 5/);
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes(fake)).toEqual([]);
  });
});

describe("18.0 AC7 — delete a set", () => {
  it("DELETE removes the row and says Set deleted", async () => {
    const { fake, user } = open();
    await ready();
    await openSet(user, /80 kg × 5/);
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(card("Bench Press")).queryByRole("button", { name: /80 kg × 5/ })).toBeNull();
    expect(announcement()).toHaveTextContent("Set deleted");
    expect(writes(fake).map((r) => r.method)).toEqual(["DELETE"]);
  });

  it("a 404 is done: the row goes and no error shows", async () => {
    const { fake, user } = open();
    await ready();
    fake.failNext({ method: "DELETE", path: /\/v1\/sets\// }, () => problemResponse(404, "not-found"));
    await openSet(user, /80 kg × 5/);
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(card("Bench Press")).queryByRole("button", { name: /80 kg × 5/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("18.0 AC6 — editing a warm-up keeps it a warm-up (/code-review #1)", () => {
  it("an unchanged Save sends nothing; a reps change sends only { reps }", async () => {
    const { fake, user } = open([{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1, setType: "warmup", weight: 40, reps: 8 }), makeSet({ setNumber: 2 })] }]);
    await ready();
    await openSet(user, /40 kg × 8/);
    expect(sheet(/^Set 1/).getByLabelText("Set type")).toHaveValue("warmup");
    await user.click(sheet(/^Set 1/).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Set 1/ })).toBeNull());
    expect(writes(fake)).toEqual([]);
    await openSet(user, /40 kg × 8/);
    await user.clear(sheet(/^Set 1/).getByLabelText("Reps"));
    await user.type(sheet(/^Set 1/).getByLabelText("Reps"), "6");
    await user.click(sheet(/^Set 1/).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fake)).toHaveLength(1));
    expect(writes(fake)[0]!.body).toEqual({ reps: 6 });
  });
});

describe("18.0 AC14 — a sheet closed mid-save does not close the next one (/code-review #3)", () => {
  it("a late success after Close leaves another sheet the lifter opened since alone", async () => {
    const { fake, workout, user } = open();
    await ready();
    const held = deferred<void>();
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, (async () => {
      await held.promise;
      return HttpResponse.json({ ...workout.exercises[0]!.sets[1]!, reps: 6 });
    }) as unknown as () => Response);
    await openSet(user, /80 kg × 5/);
    await user.clear(sheet(/^Set 2/).getByLabelText("Reps"));
    await user.type(sheet(/^Set 2/).getByLabelText("Reps"), "6");
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Save" }));
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Close" }));
    await openSet(user, /60 kg × 8/);
    await user.clear(sheet(/^Set 1/).getByLabelText("Reps"));
    await user.type(sheet(/^Set 1/).getByLabelText("Reps"), "9");
    held.resolve();
    await waitFor(() => expect(within(card("Bench Press")).getByRole("button", { name: /80 kg × 6/, hidden: true })).toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: /^Set 1/ })).toBeInTheDocument();
    expect(sheet(/^Set 1/).getByLabelText("Reps")).toHaveValue("9");
  });
});

describe("18.0 AC44 — the same announcement twice is spoken twice (final review #5)", () => {
  it("two deletes in a row re-render the status line's text node", async () => {
    const { user } = open([{ ...bench(), sets: [...bench().sets!, makeSet({ setNumber: 3, weight: 85, reps: 3 })] }]);
    await ready();
    await openSet(user, /85 kg × 3/);
    await user.click(sheet(/^Set 3/).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Set deleted"));
    const first = announcement().firstElementChild;
    await openSet(user, /80 kg × 5/);
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(announcement().firstElementChild).not.toBe(first));
    expect(announcement()).toHaveTextContent("Set deleted");
  });
});

describe("18.0 AC8 — add a set", () => {
  it("a New set sheet, copied forward, with no plan text and no Delete; one POST for two taps; the row appears", async () => {
    const plan = [1, 2, 3, 4].map(() => ({ setType: "working" as const, repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" as const }));
    const { fake, user } = open([{ ...bench(), targetSets: 4, plannedSets: plan }]);
    await ready();
    await user.click(addSetButton("Bench Press"));
    const s = sheet("New set · Bench Press");
    expect(s.getByLabelText("Weight")).toHaveValue("80");
    expect(s.getByLabelText("Reps")).toHaveValue("5");
    expect(screen.queryByText(/Set 3 of 4/)).toBeNull();
    expect(screen.queryByText(/Extra set/)).toBeNull();
    expect(s.queryByRole("button", { name: "Delete set" })).toBeNull();
    const held = deferred<void>();
    fake.failNext({ method: "POST", path: /\/sets$/ }, (async () => {
      await held.promise;
      return problemResponse(500, "about:blank");
    }) as unknown as () => Response);
    const submit = s.getByRole("button", { name: "Add set" });
    await user.click(submit);
    await user.click(submit);
    held.resolve();
    await waitFor(() => expect(s.getByRole("alert")).toHaveTextContent(EDIT_COPY.retry["create-set"]));
    const posts = writes(fake).filter((r) => r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ isComplete: true, clientGeneratedId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    await user.click(s.getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(card("Bench Press")).getAllByRole("listitem")).toHaveLength(3);
    expect(announcement()).toHaveTextContent("Set 3 added");
  });
});

describe("18.0 AC17 — retry keeps the key", () => {
  it("a network failure then Add set again re-sends the same clientGeneratedId; a new opening mints a new one", async () => {
    const { fake, user } = open();
    await ready();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => HttpResponse.error());
    await user.click(addSetButton("Bench Press"));
    await user.click(sheet("New set · Bench Press").getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(sheet("New set · Bench Press").getByRole("alert")).toHaveTextContent(EDIT_COPY.offline));
    await user.click(sheet("New set · Bench Press").getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const keys = writes(fake).map((r) => (r.body as { clientGeneratedId: string }).clientGeneratedId);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    await user.click(addSetButton("Bench Press"));
    await user.click(sheet("New set · Bench Press").getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const third = (writes(fake)[2]!.body as { clientGeneratedId: string }).clientGeneratedId;
    expect(third).not.toBe(keys[0]);
  });
});

describe("18.0 AC15 / AC16 — failures stay where the lifter acted", () => {
  const cases: [string, () => Response, (s: ReturnType<typeof sheet>) => void][] = [
    ["offline", () => HttpResponse.error(), (s) => expect(s.getByRole("alert")).toHaveTextContent(EDIT_COPY.offline)],
    ["500", () => problemResponse(500, "about:blank"), (s) => expect(s.getByRole("alert")).toHaveTextContent(EDIT_COPY.retry["update-set"])],
    ["422 reps", () => problemResponse(422, "validation-error", { errors: [{ path: "reps", message: "Required" }] }), (s) => expect(s.getByText("Required")).toBeInTheDocument()],
    ["409 workout-finished", () => problemResponse(409, "workout-finished"), (s) => expect(s.getByRole("alert")).toHaveTextContent(EDIT_COPY.retry["update-set"])],
  ];

  it.each(cases)("PATCH %s: the sheet stays open with the typed values; the cache is untouched", async (_name, response, check) => {
    const { fake, workout, user, queryClient } = open();
    await ready();
    const before = queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workout.id));
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, response);
    await openSet(user, /80 kg × 5/);
    const s = sheet(/^Set 2/);
    await user.clear(s.getByLabelText("Reps"));
    await user.type(s.getByLabelText("Reps"), "7");
    await user.click(s.getByRole("button", { name: "Save" }));
    await waitFor(() => check(s));
    expect(s.getByLabelText("Reps")).toHaveValue("7");
    expect(s.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(queryClient.getQueryData(WORKOUT_KEYS.detail(workout.id))).toBe(before);
    expect(s.queryByText("Test problem")).toBeNull();
  });

  it("delete offline shows the offline copy in the sheet", async () => {
    const { fake, user } = open();
    await ready();
    fake.failNext({ method: "DELETE", path: /\/v1\/sets\// }, () => HttpResponse.error());
    await openSet(user, /80 kg × 5/);
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(sheet(/^Set 2/).getByRole("alert")).toHaveTextContent(EDIT_COPY.offline));
    expect(within(card("Bench Press")).getByRole("button", { name: /80 kg × 5/ })).toBeInTheDocument();
  });
});

describe("18.0 AC20 — a missing set or exercise", () => {
  it("PATCH 404: the sheet closes, the banner says the set is gone, the detail is re-read", async () => {
    const { fake, workout, user } = open();
    await ready();
    const reads = () => fake.requests.filter((r) => r.method === "GET" && r.path === `/v1/workouts/${workout.id}`).length;
    const before = reads();
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, () => problemResponse(404, "not-found"));
    await openSet(user, /80 kg × 5/);
    await user.clear(sheet(/^Set 2/).getByLabelText("Reps"));
    await user.type(sheet(/^Set 2/).getByLabelText("Reps"), "6");
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(EDIT_COPY.setMissing)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it("Add set 404: That exercise was removed from the workout", async () => {
    const { fake, user } = open();
    await ready();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(404, "not-found"));
    await user.click(addSetButton("Bench Press"));
    await user.click(sheet("New set · Bench Press").getByRole("button", { name: "Add set" }));
    expect(await screen.findByText(EDIT_COPY.exerciseMissing)).toBeInTheDocument();
  });

  it("when the re-read also 404s, the vanished view replaces the screen", async () => {
    const { fake, workout, user } = open();
    await ready();
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, () => problemResponse(404, "not-found"));
    await openSet(user, /80 kg × 5/);
    fake.state.finished.delete(workout.id);
    await user.clear(sheet(/^Set 2/).getByLabelText("Reps"));
    await user.type(sheet(/^Set 2/).getByLabelText("Reps"), "6");
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(EDIT_COPY.vanished)).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("18.0 AC13 — Done waits for writes", () => {
  it("Done is disabled with Saving… while a PATCH is held, enabled after", async () => {
    const { fake, user } = open();
    await ready();
    const held = deferred<void>();
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, (async () => {
      await held.promise;
      return problemResponse(500, "about:blank");
    }) as unknown as () => Response);
    await openSet(user, /80 kg × 5/);
    await user.clear(sheet(/^Set 2/).getByLabelText("Reps"));
    await user.type(sheet(/^Set 2/).getByLabelText("Reps"), "6");
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(editDoneButton()).toBeDisabled());
    expect(screen.getByText(EDIT_COPY.saving)).toBeInTheDocument();
    held.resolve();
    await waitFor(() => expect(editDoneButton()).toBeEnabled());
  });
});

describe("18.0 AC14 — no pending state", () => {
  it("while a PATCH is held the row keeps its old value and nothing says Not saved yet", async () => {
    const { fake, user } = open();
    await ready();
    const held = deferred<void>();
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, (async () => {
      await held.promise;
      return problemResponse(500, "about:blank");
    }) as unknown as () => Response);
    await openSet(user, /80 kg × 5/);
    await user.clear(sheet(/^Set 2/).getByLabelText("Reps"));
    await user.type(sheet(/^Set 2/).getByLabelText("Reps"), "6");
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(editDoneButton()).toBeDisabled());
    expect(within(card("Bench Press")).getByRole("button", { name: /80 kg × 5/, hidden: true })).toBeInTheDocument();
    expect(screen.queryByText("Not saved yet")).toBeNull();
    held.resolve();
  });
});

describe("18.0 AC8 — Review Focus 3, 4, 5", () => {
  it.each([
    ["distance_duration", "Row erg", ["Distance", "Minutes", "Seconds"], ["reps", "weight"]],
    ["bodyweight_reps", "Push-up", ["Reps"], ["weight", "distance", "durationS"]],
  ] as const)("%s with no sets: blank fields; the POST carries only that modality's measures", async (modality, name, labels, forbidden) => {
    const { fake, user } = open([{ modality, name }]);
    await ready();
    await user.click(addSetButton(name));
    const s = sheet(`New set · ${name}`);
    for (const label of labels) expect(s.getByLabelText(label)).toHaveValue("");
    if (modality === "distance_duration") {
      await user.type(s.getByLabelText("Distance"), "2");
      await user.type(s.getByLabelText("Minutes"), "8");
    } else {
      await user.type(s.getByLabelText("Reps"), "12");
    }
    await user.click(s.getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const body = writes(fake)[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ isComplete: true, clientGeneratedId: expect.any(String) });
    for (const key of forbidden) expect(body[key] ?? null).toBeNull();
  });

  it("two Bench Press cards: Add set on the second posts to the second's exercise", async () => {
    const { fake, workout, user } = open([bench(), { ...bench(), sets: [makeSet({ setNumber: 1, weight: 50, reps: 10 })] }]);
    await ready();
    const second = workout.exercises[1]!.id;
    const buttons = screen.getAllByRole("button", { name: "Add set to Bench Press" });
    await user.click(buttons[1]!);
    expect(sheet("New set · Bench Press").getByLabelText("Weight")).toHaveValue("50");
    await user.click(sheet("New set · Bench Press").getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes(fake)[0]!.path).toBe(`/v1/workout-exercises/${second}/sets`);
  });

  it("an lb set on a kg account: the edit sheet keeps lb, and Add set copied forward sends lb", async () => {
    const { fake, user } = open([{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1, weight: 135, weightUnit: "lb", reps: 5 })] }], { unitPreference: "kg" });
    await ready();
    await openSet(user, /135 lb × 5/);
    expect(sheet(/^Set 1/).getByLabelText("Weight unit")).toHaveValue("lb");
    await user.click(sheet(/^Set 1/).getByRole("button", { name: "Close" }));
    await user.click(addSetButton("Bench Press"));
    await user.click(sheet("New set · Bench Press").getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes(fake)[0]!.body).toMatchObject({ weight: 135, weightUnit: "lb" });
  });
});
