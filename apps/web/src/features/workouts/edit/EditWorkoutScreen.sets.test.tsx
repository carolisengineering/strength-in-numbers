import { screen, waitFor, within } from "@testing-library/react";
import { segmentChoice } from "../../../test/controls";
import { http, HttpResponse } from "msw";
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
import { API_BASE_URL } from "../../../test/catalogHarness";
import { server } from "../../../test/msw/server";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../../test/workoutHarness";
import { addSetButton, card, deleteSetIn, editDoneButton } from "../../../test/sessionHelpers";
import { sheetBody, sheetRow } from "../../../test/sheetHelpers";
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

describe("17.5 AC18 — the first tap asks (edit sheet)", () => {
  it("sends nothing, says what goes, focuses Keep set; Keep set returns with typed values", async () => {
    const { fake, user } = open();
    await ready();
    await openSet(user, /80 kg × 5/);
    await user.type(sheet(/^Set 2/).getByLabelText("Reps"), "{Control>}a{/Control}12");
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Delete set" }));
    expect(writes(fake)).toHaveLength(0);
    expect(sheet(/^Set 2/).getByRole("button", { name: "Keep set", description: "Delete set 2? 80 kg × 5 will be removed." })).toBeInTheDocument();
    expect(sheet(/^Set 2/).getByRole("button", { name: "Keep set" })).toHaveFocus();
    expect(sheet(/^Set 2/).queryByRole("button", { name: "Save" })).toBeNull();
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Keep set" }));
    expect(sheet(/^Set 2/).getByLabelText("Reps")).toHaveValue("12");
    expect(sheet(/^Set 2/).getByRole("button", { name: "Delete set" })).toHaveFocus();
  });

  it("Add mode has no Delete set and no confirm", async () => {
    const { user } = open();
    await ready();
    await user.click(addSetButton("Bench Press"));
    const s = sheet(/^New set/);
    expect(s.queryByRole("button", { name: "Delete set" })).toBeNull();
    expect(s.queryByRole("button", { name: "Keep set" })).toBeNull();
  });
});

describe("17.5 AC19 — the second tap commits (edit sheet)", () => {
  it("the sheet waits for the answer, then closes", async () => {
    const { user } = open();
    await ready();
    const gate = deferred<void>();
    server.use(http.delete(`${API_BASE_URL}/v1/sets/:id`, async () => {
      await gate.promise;
      return new HttpResponse(null, { status: 204 });
    }));
    await openSet(user, /80 kg × 5/);
    await deleteSetIn(user, sheet(/^Set 2/));
    expect(screen.getByRole("dialog", { name: /^Set 2/ })).toBeInTheDocument();
    gate.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a failure closes the confirm and shows its alert, with the typed values kept", async () => {
    const { fake, user } = open();
    await ready();
    fake.failNext({ method: "DELETE", path: /\/v1\/sets\// }, () => problemResponse(500, "boom"));
    await openSet(user, /80 kg × 5/);
    await user.type(sheet(/^Set 2/).getByLabelText("Reps"), "{Control>}a{/Control}12");
    await deleteSetIn(user, sheet(/^Set 2/));
    await waitFor(() => expect(sheet(/^Set 2/).getByRole("alert")).toBeInTheDocument());
    expect(sheet(/^Set 2/).queryByRole("group", { name: /will be removed/ })).toBeNull();
    expect(sheet(/^Set 2/).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(sheet(/^Set 2/).getByLabelText("Reps")).toHaveValue("12");
    await waitFor(() => expect(sheet(/^Set 2/).getByRole("button", { name: "Delete set" })).toHaveFocus());
  });
});

describe("17.5 AC20 — the last set", () => {
  it("the 409 dialog still opens after the confirm, whose text doesn't mention it", async () => {
    const { fake, user } = open([{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }]);
    await ready();
    await openSet(user, /60 kg × 8/);
    await user.click(sheet(/^Set 1/).getByRole("button", { name: "Delete set" }));
    expect(sheet(/^Set 1/).getByRole("button", { name: "Keep set", description: "Delete set 1? 60 kg × 8 will be removed." })).toBeInTheDocument();
    expect(writes(fake)).toHaveLength(0);
    await user.click(sheet(/^Set 1/).getByRole("button", { name: "Delete set" }));
    await screen.findByRole("dialog", { name: EDIT_COPY.lastSet.title });
  });
});

describe("18.0 AC7 — delete a set", () => {
  it("DELETE removes the row and says Set deleted", async () => {
    const { fake, user } = open();
    await ready();
    await openSet(user, /80 kg × 5/);
    await deleteSetIn(user, sheet(/^Set 2/));
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
    await deleteSetIn(user, sheet(/^Set 2/));
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
    expect(segmentChoice("Set type", sheet(/^Set 1/))).toBe("warmup");
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

// Was "a sheet closed mid-save does not close the next one" (/code-review #3): since minor 494 the sheet can't be
// closed mid-save at all, so a late answer always lands on the sheet that asked. `EditSetForm`'s `mounted` guard stays.
describe("18.0 AC14, minor 494 — the set sheet stays open while a write is in flight", () => {
  it("Cancel and Close do nothing during a save; a failure then shows in the sheet with the typed values", async () => {
    const { fake, user } = open();
    await ready();
    const held = deferred<void>();
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, (async () => {
      await held.promise;
      return problemResponse(500, "about:blank");
    }) as unknown as () => Response);
    await openSet(user, /80 kg × 5/);
    await user.type(sheet(/^Set 2/).getByLabelText("Reps"), "{Control>}a{/Control}6");
    await user.click(sheetRow().getByRole("button", { name: "Save" }));
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    await user.click(sheet(/^Set 2/).getByRole("button", { name: "Close" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: /^Set 2/ })).toBeInTheDocument();
    expect(sheetRow().getByRole("button", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");
    held.resolve();
    await waitFor(() => expect(sheetRow().getByRole("alert")).toHaveTextContent(EDIT_COPY.retry["update-set"]));
    expect(sheet(/^Set 2/).getByLabelText("Reps")).toHaveValue("6");
    expect(sheetRow().getByRole("button", { name: "Cancel" })).not.toHaveAttribute("aria-disabled");
  });

  it("the same during a delete; after a success the sheet closes", async () => {
    const { fake, user } = open();
    await ready();
    const held = deferred<void>();
    fake.failNext({ method: "DELETE", path: /\/v1\/sets\// }, (async () => {
      await held.promise;
      return new HttpResponse(null, { status: 204 });
    }) as unknown as () => Response);
    await openSet(user, /80 kg × 5/);
    await deleteSetIn(user, sheet(/^Set 2/));
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: /^Set 2/ })).toBeInTheDocument();
    held.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(announcement()).toHaveTextContent("Set deleted");
  });
});

describe("18.0 AC44 — the same announcement twice is spoken twice (final review #5)", () => {
  it("two deletes in a row re-render the status line's text node", async () => {
    const { user } = open([{ ...bench(), sets: [...bench().sets!, makeSet({ setNumber: 3, weight: 85, reps: 3 })] }]);
    await ready();
    await openSet(user, /85 kg × 3/);
    await deleteSetIn(user, sheet(/^Set 3/));
    await waitFor(() => expect(announcement()).toHaveTextContent("Set deleted"));
    const first = announcement().firstElementChild;
    await openSet(user, /80 kg × 5/);
    await deleteSetIn(user, sheet(/^Set 2/));
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
    await deleteSetIn(user, sheet(/^Set 2/));
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
    expect(segmentChoice("Weight unit", sheet(/^Set 1/))).toBe("lb");
    await user.click(sheet(/^Set 1/).getByRole("button", { name: "Close" }));
    await user.click(addSetButton("Bench Press"));
    await user.click(sheet("New set · Bench Press").getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes(fake)[0]!.body).toMatchObject({ weight: 135, weightUnit: "lb" });
  });
});

describe("17.10 AC14, AC7 — the edit screen's set sheet uses the action row", () => {
  const rowNames = () => sheetRow().getAllByRole("button").map((b) => b.textContent);

  it("edit: Delete set, Cancel, Save in the row and none in the body; one Cancel in the dialog", async () => {
    const { user } = open();
    await ready();
    await openSet(user, /80 kg × 5/);
    expect(rowNames()).toEqual(["Delete set", "Cancel", "Save"]);
    for (const name of ["Delete set", "Save", "Cancel"]) expect(within(sheetBody()).queryByRole("button", { name })).toBeNull();
    expect(sheet(/^Set 2/).getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
  });

  it("add: Cancel then Add set", async () => {
    const { user } = open();
    await ready();
    await user.click(addSetButton("Bench Press"));
    expect(rowNames()).toEqual(["Cancel", "Add set"]);
    expect(sheet("New set · Bench Press").getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
  });

  it("asking: Keep set (focused) where Delete set was, the confirm's Delete set where Save was", async () => {
    const { fake, user } = open();
    await ready();
    await openSet(user, /80 kg × 5/);
    await user.click(sheetRow().getByRole("button", { name: "Delete set" }));
    const buttons = sheetRow().getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Keep set", "Cancel", "Delete set"]);
    expect(buttons[0]).toHaveFocus();
    await user.click(buttons[0]!);
    expect(writes(fake)).toHaveLength(0);
    expect(sheetRow().getByRole("button", { name: "Delete set" })).toHaveFocus();
  });

  it("Review Focus 1: a failed save's alert is in the row", async () => {
    const { fake, user } = open();
    await ready();
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, () => problemResponse(500, "about:blank"));
    await openSet(user, /80 kg × 5/);
    await user.type(sheet(/^Set 2/).getByLabelText("Reps"), "{Control>}a{/Control}7");
    await user.click(sheetRow().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sheetRow().getByRole("alert")).toHaveTextContent(EDIT_COPY.retry["update-set"]));
    expect(within(sheetBody()).queryByRole("alert")).toBeNull();
  });

  it("Review Focus 1: a failed delete's alert is in the row, after the confirm", async () => {
    const { fake, user } = open();
    await ready();
    fake.failNext({ method: "DELETE", path: /\/v1\/sets\// }, () => HttpResponse.error());
    await openSet(user, /80 kg × 5/);
    await deleteSetIn(user, sheet(/^Set 2/));
    await waitFor(() => expect(sheetRow().getByRole("alert")).toHaveTextContent(EDIT_COPY.offline));
    expect(rowNames()).toEqual(["Delete set", "Cancel", "Save"]);
  });
});
