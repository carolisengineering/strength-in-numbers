import { MODALITY_VALUES, type Modality } from "@sin/core";
import { screen, waitFor, within } from "@testing-library/react";
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
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { API_BASE_URL } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

async function setup(exercises: ExerciseSpec[], unitPreference: "kg" | "lb" = "kg") {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake, unitPreference });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

const card = (name: string) => screen.getByRole("article", { name });
const setPosts = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));
const activeReads = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;
const logButton = (name = "X") => within(card(name)).getByRole("button", { name: "Log set" });

const FIELDS: Record<Modality, { shown: string[]; hidden: string[]; units: string[] }> = {
  weight_reps: { shown: ["Weight", "Reps"], hidden: ["Added weight", "Minutes", "Seconds", "Distance"], units: ["Weight unit"] },
  bodyweight_reps: { shown: ["Reps"], hidden: ["Weight", "Added weight", "Minutes", "Seconds", "Distance"], units: [] },
  weighted_bodyweight: { shown: ["Added weight", "Reps"], hidden: ["Weight", "Minutes", "Seconds", "Distance"], units: ["Weight unit"] },
  duration: { shown: ["Minutes", "Seconds"], hidden: ["Weight", "Added weight", "Reps", "Distance"], units: [] },
  distance_duration: { shown: ["Distance", "Minutes", "Seconds"], hidden: ["Weight", "Added weight", "Reps"], units: ["Distance unit"] },
};

describe("AC21 — entry row fields per modality", () => {
  it.each(MODALITY_VALUES)("%s shows exactly its measures and no forbidden one", async (modality) => {
    await setup([{ modality, name: "X" }]);
    const row = within(card("X"));

    for (const label of FIELDS[modality].shown) expect(row.getByLabelText(label)).toBeInTheDocument();
    for (const label of FIELDS[modality].units) expect(row.getByLabelText(label)).toBeInTheDocument();
    for (const label of FIELDS[modality].hidden) expect(row.queryByLabelText(label)).not.toBeInTheDocument();
    if (FIELDS[modality].units.length === 0) expect(row.queryByLabelText(/unit/)).not.toBeInTheDocument();
  });

  it.each(MODALITY_VALUES)("%s also offers Set type (default Working) and an optional RPE under More", async (modality) => {
    await setup([{ modality, name: "X" }]);
    const row = within(card("X"));

    expect(row.getByLabelText("Set type")).toHaveValue("working");
    expect(row.getByText("More").closest("details")).toContainElement(row.getByLabelText("RPE"));
  });

  it("numeric inputs are text inputs with a numeric keypad, never type=number", async () => {
    await setup([{ modality: "distance_duration", name: "X" }]);
    const row = within(card("X"));

    expect(row.getByLabelText("Distance")).toHaveAttribute("inputmode", "decimal");
    expect(row.getByLabelText("Minutes")).toHaveAttribute("inputmode", "numeric");
    expect(row.getByLabelText("Seconds")).toHaveAttribute("inputmode", "numeric");
    expect(row.getByLabelText("RPE")).toHaveAttribute("inputmode", "decimal");
    for (const input of card("X").querySelectorAll("input")) expect(input).toHaveAttribute("type", "text");
  });

  it("units default from the profile: kg → kg / km", async () => {
    await setup([{ modality: "weight_reps", name: "X" }, { modality: "distance_duration", name: "Y" }], "kg");
    expect(within(card("X")).getByLabelText("Weight unit")).toHaveValue("kg");
    expect(within(card("Y")).getByLabelText("Distance unit")).toHaveValue("km");
  });

  it("units default from the profile: lb → lb / mi", async () => {
    await setup([{ modality: "weight_reps", name: "X" }, { modality: "distance_duration", name: "Y" }], "lb");
    expect(within(card("X")).getByLabelText("Weight unit")).toHaveValue("lb");
    expect(within(card("Y")).getByLabelText("Distance unit")).toHaveValue("mi");
  });

  it("Failure shows the log-0-reps hint", async () => {
    const { user } = await setup([{ modality: "weight_reps", name: "X" }]);
    await user.selectOptions(within(card("X")).getByLabelText("Set type"), "failure");
    expect(within(card("X")).getByText("Couldn't complete a rep? Log 0 reps.")).toBeInTheDocument();
  });

  it("the Set type select offers the four types", async () => {
    await setup([{ modality: "weight_reps", name: "X" }]);
    const options = within(within(card("X")).getByLabelText("Set type")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Warm-up", "Working", "Drop", "Failure"]);
  });
});

describe("AC22 — prefill", () => {
  it("with no sets the inputs are empty", async () => {
    await setup([{ modality: "weight_reps", name: "X" }]);
    expect(within(card("X")).getByLabelText("Weight")).toHaveValue("");
    expect(within(card("X")).getByLabelText("Reps")).toHaveValue("");
  });

  it("with sets it starts from the last logged set (values and units), with the type reset to Working", async () => {
    await setup([
      {
        modality: "weight_reps",
        name: "X",
        sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 }), makeSet({ setNumber: 2, weight: 62.5, weightUnit: "lb", reps: 6, setType: "warmup" })],
      },
    ]);
    const row = within(card("X"));
    expect(row.getByLabelText("Weight")).toHaveValue("62.5");
    expect(row.getByLabelText("Reps")).toHaveValue("6");
    expect(row.getByLabelText("Weight unit")).toHaveValue("lb");
    expect(row.getByLabelText("Set type")).toHaveValue("working");
  });

  it("after a log the values stay (copy-forward) and the next POST carries a fresh key", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(card("X"));
    await user.type(row.getByLabelText("Weight"), "60");
    await user.type(row.getByLabelText("Reps"), "8");

    await user.click(logButton());
    await within(card("X")).findByText(/60 kg × 8/);
    expect(row.getByLabelText("Weight")).toHaveValue("60");
    await user.click(logButton());
    await waitFor(() => expect(setPosts(fake)).toHaveLength(2));

    const keys = setPosts(fake).map((r) => (r.body as Record<string, unknown>)["clientGeneratedId"]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((k) => typeof k === "string")).toBe(true);
  });
});

describe("AC23 — Log set", () => {
  it("is disabled until the draft parses, and enabled once it does", async () => {
    const { user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(card("X"));
    expect(logButton()).toBeDisabled();

    await user.type(row.getByLabelText("Weight"), "60");
    expect(logButton()).toBeDisabled();
    await user.type(row.getByLabelText("Reps"), "8");
    expect(logButton()).toBeEnabled();
    await user.clear(row.getByLabelText("Reps"));
    expect(logButton()).toBeDisabled();
  });

  it("sends one POST with the parsed body, isComplete and the attempt key; the set appears; nothing refetches", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(card("X"));
    await user.type(row.getByLabelText("Weight"), "52,5");
    await user.type(row.getByLabelText("Reps"), "8");
    const readsBefore = activeReads(fake);

    await user.click(logButton());

    expect(await row.findByText("52.5 kg × 8")).toBeInTheDocument();
    expect(setPosts(fake)).toHaveLength(1);
    expect(setPosts(fake)[0]!.body).toEqual({
      setType: "working",
      weight: 52.5,
      weightUnit: "kg",
      reps: 8,
      isComplete: true,
      clientGeneratedId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(activeReads(fake)).toBe(readsBefore);
  });

  it("announces the logged set politely and leaves focus on the Log button", async () => {
    const { user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(card("X"));
    await user.type(row.getByLabelText("Weight"), "60");
    await user.type(row.getByLabelText("Reps"), "8");

    await user.click(logButton());

    await waitFor(() => expect(row.getByRole("status")).toHaveTextContent("Set 1 logged"));
    expect(logButton()).toHaveFocus();
  });

  it("a failed attempt (0 reps) with a weight logs", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(card("X"));
    await user.selectOptions(row.getByLabelText("Set type"), "failure");
    await user.type(row.getByLabelText("Weight"), "100");
    await user.type(row.getByLabelText("Reps"), "0");

    await user.click(logButton());

    expect(await row.findByText(/100 kg × 0 \(Failure\)/)).toBeInTheDocument();
    expect(setPosts(fake)[0]!.body).toMatchObject({ setType: "failure", reps: 0, weight: 100 });
  });

  it("a second tap while the first is still in flight sends nothing", async () => {
    const { user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(card("X"));
    await user.type(row.getByLabelText("Weight"), "60");
    await user.type(row.getByLabelText("Reps"), "8");
    const gate = deferred<void>();
    let posts = 0;
    server.use(
      http.post(`${API_BASE_URL}/v1/workout-exercises/:id/sets`, async () => {
        posts += 1;
        await gate.promise;
        return problemResponse(500, "about:blank");
      }),
    );

    await user.dblClick(logButton());

    expect(logButton()).toHaveAttribute("aria-busy", "true");
    gate.resolve();
    await row.findByRole("alert");
    expect(posts).toBe(1);
  });

  it("values typed while the POST is in flight survive the response, and the next tap logs them (final review I3)", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const exerciseRowId = fake.state.active!.exercises[0]!.id;
    const row = within(card("X"));
    await user.type(row.getByLabelText("Weight"), "60");
    await user.type(row.getByLabelText("Reps"), "8");
    const gate = deferred<void>();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${API_BASE_URL}/v1/workout-exercises/:id/sets`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        if (bodies.length === 1) await gate.promise;
        return HttpResponse.json(
          makeSet({ workoutExerciseId: exerciseRowId, setNumber: bodies.length, weight: bodies.length === 1 ? 60 : 65, reps: 8 }),
          { status: 201 },
        );
      }),
    );

    await user.click(logButton());
    const weight = row.getByLabelText("Weight");
    await user.clear(weight);
    await user.type(weight, "65"); // the next set's weight, typed on a slow link before the response
    gate.resolve();
    await row.findByText("60 kg × 8");

    expect(weight).toHaveValue("65"); // not snapped back to the logged set's 60
    await user.click(logButton());
    await row.findByText("65 kg × 8");
    expect(bodies[1]).toMatchObject({ weight: 65 });
    expect(bodies[1]!["clientGeneratedId"]).not.toBe(bodies[0]!["clientGeneratedId"]);
  });

  it("tapping again after a set is logged logs the same values again (the one-tap same-again set)", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(card("X"));
    await user.type(row.getByLabelText("Weight"), "60");
    await user.type(row.getByLabelText("Reps"), "8");

    await user.click(logButton());
    await waitFor(() => expect(row.getAllByText("60 kg × 8")).toHaveLength(1));
    await user.click(logButton());

    await waitFor(() => expect(row.getAllByText("60 kg × 8")).toHaveLength(2));
    expect(setPosts(fake)).toHaveLength(2);
  });

  it("logs a duration set from minutes and seconds", async () => {
    const { fake, user } = await setup([{ modality: "duration", name: "X" }]);
    const row = within(card("X"));
    await user.type(row.getByLabelText("Minutes"), "1");
    await user.type(row.getByLabelText("Seconds"), "30");

    await user.click(logButton());

    expect(await row.findByText("1:30")).toBeInTheDocument();
    expect(setPosts(fake)[0]!.body).toMatchObject({ durationS: 90 });
  });

  it("track set_logged carries only modality, set type, edited and msToLog", async () => {
    const { user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(card("X"));
    await user.type(row.getByLabelText("Weight"), "60");
    await user.type(row.getByLabelText("Reps"), "8");

    await user.click(logButton());
    await row.findByText("60 kg × 8");

    const call = observability.track.mock.calls.find(([name]) => name === "set_logged")!;
    expect(Object.keys(call[1] as object).sort()).toEqual(["edited", "modality", "msToLog", "setType"]);
    expect(call[1]).toMatchObject({ modality: "weight_reps", setType: "working", edited: true });
  });
});

describe("AC24 — Log set failures", () => {
  async function filled() {
    const ctx = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(card("X"));
    await ctx.user.type(row.getByLabelText("Weight"), "60");
    await ctx.user.type(row.getByLabelText("Reps"), "8");
    return { ...ctx, row };
  }

  it("422 maps errors[].path to the matching field", async () => {
    const { fake, user, row } = await filled();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "weight", message: "Too heavy" }] }),
    );

    await user.click(logButton());

    expect(await row.findByText("Too heavy")).toBeInTheDocument();
    expect(row.getByLabelText("Weight")).toHaveAttribute("aria-invalid", "true");
    expect(row.getByLabelText("Weight")).toHaveValue("60");
    expect(logButton()).toBeEnabled();
  });

  it("422 with a path that matches no field shows a form-level message", async () => {
    const { fake, user, row } = await filled();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "isComplete", message: "Cannot complete this set" }] }),
    );

    await user.click(logButton());

    expect(await row.findByRole("alert")).toHaveTextContent("Cannot complete this set");
    expect(logButton()).toBeEnabled();
  });

  it("a network failure keeps the draft, says so, and the retry reuses the same attempt key", async () => {
    const { fake, user, row } = await filled();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => HttpResponse.error());

    await user.click(logButton());

    expect(await row.findByRole("alert")).toHaveTextContent("Couldn't log set — try again");
    expect(row.getByLabelText("Weight")).toHaveValue("60");
    expect(logButton()).toBeEnabled();
    await user.click(logButton());

    await row.findByText("60 kg × 8");
    const [first, second] = setPosts(fake);
    expect((second!.body as Record<string, unknown>)["clientGeneratedId"]).toBe(
      (first!.body as Record<string, unknown>)["clientGeneratedId"],
    );
    expect(row.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a 5xx failure is the same retryable message", async () => {
    const { fake, user, row } = await filled();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(500, "about:blank"));

    await user.click(logButton());

    expect(await row.findByRole("alert")).toHaveTextContent("Couldn't log set — try again");
  });

  it("a 404 while the workout still exists does not claim the workout is gone (final review I4)", async () => {
    const { fake, user, row } = await filled();
    // The exercise was removed on another device; the workout itself is fine.
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(404, "not-found"));

    await user.click(logButton());

    expect(await screen.findByText("Your workout was out of date, so it has been reloaded.")).toBeInTheDocument();
    expect(screen.queryByText(/already finished or removed/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workout" })).toBeInTheDocument();
    expect(row.getByLabelText("Weight")).toBeInTheDocument();
  });

  it("404 and 409 workout-finished take the gone path", async () => {
    const { fake, user } = await filled();
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(409, "workout-finished"));
    fake.state.active = null;

    await user.click(logButton());

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("That workout was already finished or removed.");
  });
});
