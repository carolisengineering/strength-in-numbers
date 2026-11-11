import { screen, waitFor, within } from "@testing-library/react";
import { chooseSegmentValue, segmentChoice, segmented } from "../../test/controls";
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

import type { Modality } from "@sin/core";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { deleteSetIn } from "../../test/sessionHelpers";
import { sheetBody, sheetRow } from "../../test/sheetHelpers";

afterEach(() => cleanupApp());

async function setup(
  sets = [makeSet({ setNumber: 1, weight: 60, reps: 8 }), makeSet({ setNumber: 2, weight: 60, reps: 7 })],
  modality: Modality = "weight_reps",
) {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({ exercises: [{ modality, name: "X", sets }] }),
  });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

const card = () => screen.getByRole("article", { name: "X" });
const setRow = (text: RegExp) => within(card()).getByRole("button", { name: text });
const dialog = () => screen.getByRole("dialog", { name: /^Set \d · X$/ });
const requests = (fake: ReturnType<typeof createWorkoutFake>, method: string) =>
  fake.requests.filter((r) => r.method === method);
const activeReads = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;

describe("17.8 AC16 — the sheet has steppers", () => {
  const openFirstRow = async (user: Awaited<ReturnType<typeof setup>>["user"]) => {
    await user.click(card().querySelector("ol button") as HTMLElement);
    return within(dialog());
  };

  it("weight × reps: the AC4 names with the exercise; unit and set type are radios; Save and Delete set as before", async () => {
    const { user } = await setup();
    const d = await openFirstRow(user);
    expect(d.getByRole("button", { name: "+2.5 kg, increase weight for X" })).toHaveTextContent(/^\+2\.5$/);
    expect(d.getByRole("button", { name: "\u22121, decrease reps for X" })).toHaveTextContent(/^\u22121$/);
    expect(segmented("Weight unit", dialog())).toBeInTheDocument();
    expect(segmented("Set type", dialog())).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Delete set" })).toBeInTheDocument();
  });

  it.each<[Modality, Record<string, unknown>, string]>([
    ["calories", { reps: null, weight: null, weightUnit: null, weightKg: null, calories: 20 }, "+5, increase calories for X"],
    ["duration", { reps: null, weight: null, weightUnit: null, weightKg: null, durationS: 45 }, "+5 s, increase time for X"],
    ["weight_distance", { reps: null, weight: 24, distance: 40, distanceUnit: "m", distanceM: 40 }, "+10 m, increase distance for X"],
  ])("%s has its steppers", async (modality, values, name) => {
    const { user } = await setup([makeSet({ setNumber: 1, ...values })], modality);
    const d = await openFirstRow(user);
    expect(d.getByRole("button", { name })).toBeInTheDocument();
  });

  it("a draft that doesn't parse keeps Save disabled, and a step makes it valid again", async () => {
    const { user } = await setup();
    const d = await openFirstRow(user);
    await user.clear(d.getByLabelText("Reps"));
    expect(d.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(d.getByRole("button", { name: "+1, increase reps for X" }));
    expect(d.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("Review Focus 4: on a set with RPE 8, up then down and Save sends nothing; up and Save sends the weight and no rpe", async () => {
    const { fake, user } = await setup([makeSet({ setNumber: 1, weight: 60, reps: 8, rpe: 8 })]);
    let d = await openFirstRow(user);
    await user.click(d.getByRole("button", { name: "+2.5 kg, increase weight for X" }));
    await user.click(d.getByRole("button", { name: "\u22122.5 kg, decrease weight for X" }));
    await user.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Set \d · X$/ })).toBeNull());
    expect(requests(fake, "PATCH")).toHaveLength(0);
    d = await openFirstRow(user);
    await user.click(d.getByRole("button", { name: "+2.5 kg, increase weight for X" }));
    await user.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(requests(fake, "PATCH")).toHaveLength(1));
    expect(requests(fake, "PATCH")[0]!.body).toEqual({ weight: 62.5 });
  });
});

describe("17.5 AC18 — the first tap asks (live sheet)", () => {
  async function asked() {
    const app = await setup();
    await app.user.click(setRow(/60 kg × 8/));
    await app.user.click(within(dialog()).getByRole("button", { name: "Delete set" }));
    return app;
  }

  it("sends nothing, says what goes, and focuses Keep set, with no nested dialog", async () => {
    const { fake } = await asked();
    expect(requests(fake, "DELETE")).toHaveLength(0);
    expect(within(dialog()).getByRole("button", { name: "Keep set", description: "Delete set 1? 60 kg × 8 will be removed." })).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Keep set" })).toHaveFocus();
    expect(within(dialog()).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Delete set" })).toHaveAttribute("data-variant", "danger");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("Keep set brings the row back with typed values untouched, and focus on Delete set", async () => {
    const { user } = await setup();
    await user.click(setRow(/60 kg × 8/));
    await user.type(within(dialog()).getByLabelText("Reps"), "{Control>}a{/Control}12");
    await user.click(within(dialog()).getByRole("button", { name: "Delete set" }));
    await user.click(within(dialog()).getByRole("button", { name: "Keep set" }));
    expect(within(dialog()).getByLabelText("Reps")).toHaveValue("12");
    expect(within(dialog()).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Delete set" })).toHaveFocus();
    expect(within(dialog()).queryByText(/will be removed/)).not.toBeInTheDocument();
  });

  it("Close still closes the sheet", async () => {
    const { fake, user } = await asked();
    await user.click(within(dialog()).getByRole("button", { name: /^Close/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(requests(fake, "DELETE")).toHaveLength(0);
  });

  it("Enter in a field sends nothing and keeps the confirm up (Review Focus 4)", async () => {
    const { fake, user } = await setup([makeSet({ setNumber: 1, weight: null, weightKg: null, weightUnit: null, reps: 8 })], "bodyweight_reps");
    await user.click(setRow(/8/));
    const reps = within(dialog()).getByLabelText("Reps");
    await user.type(reps, "{Control>}a{/Control}9");
    await user.click(within(dialog()).getByRole("button", { name: "Delete set" }));
    await user.type(reps, "{Enter}");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests(fake, "PATCH")).toHaveLength(0);
    expect(within(dialog()).getByText(/will be removed/)).toBeInTheDocument();
    expect(reps).toHaveValue("9");
  });
});

describe("17.5 AC19 — the second tap commits (live sheet)", () => {
  it("the sheet closes at once and the DELETE goes", async () => {
    const { fake, user } = await setup();
    await user.click(setRow(/60 kg × 8/));
    await deleteSetIn(user, dialog());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(requests(fake, "DELETE")).toHaveLength(1));
  });
});

describe("AC25 — edit and delete a logged set", () => {
  it("tapping a row opens a sheet titled with the set number and exercise, fields prefilled", async () => {
    const { user } = await setup();

    await user.click(setRow(/60 kg × 8/));

    const sheet = screen.getByRole("dialog", { name: "Set 1 · X" });
    expect(within(sheet).getByLabelText("Weight")).toHaveValue("60");
    expect(within(sheet).getByLabelText("Reps")).toHaveValue("8");
    expect(segmentChoice("Weight unit", within(sheet))).toBe("kg");
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Delete set" })).toBeInTheDocument();
  });

  it("a weight-only edit sends only { weight } and updates the row without a refetch", async () => {
    const { fake, user } = await setup();
    const reads = activeReads(fake);
    await user.click(setRow(/60 kg × 8/));
    const weight = within(dialog()).getByLabelText("Weight");

    await user.clear(weight);
    await user.type(weight, "62.5");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(await within(card()).findByText("62.5 kg × 8")).toBeInTheDocument();
    expect(requests(fake, "PATCH").map((r) => r.body)).toEqual([{ weight: 62.5 }]);
    expect(screen.queryByRole("dialog", { name: /^Set/ })).not.toBeInTheDocument();
    expect(activeReads(fake)).toBe(reads);
  });

  it("a unit-only edit sends only { weightUnit }", async () => {
    const { fake, user } = await setup();
    await user.click(setRow(/60 kg × 8/));

    await chooseSegmentValue(user, "Weight unit", "lb", within(dialog()));
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    await within(card()).findByText("60 lb × 8");
    expect(requests(fake, "PATCH").map((r) => r.body)).toEqual([{ weightUnit: "lb" }]);
  });

  it("no change closes the sheet without a request", async () => {
    const { fake, user } = await setup();
    await user.click(setRow(/60 kg × 8/));

    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Set/ })).not.toBeInTheDocument());
    expect(requests(fake, "PATCH")).toHaveLength(0);
  });

  it("#129 — an unchanged Save on a warm-up sends no request (the sheet keeps the stored set type)", async () => {
    const { fake, user } = await setup([makeSet({ setNumber: 1, setType: "warmup", weight: 40, reps: 8 })]);
    await user.click(setRow(/40 kg × 8/));
    expect(segmentChoice("Set type", within(dialog()))).toBe("warmup");

    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Set/ })).not.toBeInTheDocument());
    expect(requests(fake, "PATCH")).toHaveLength(0);
  });

  it("clearing a required measure blocks Save with a field message", async () => {
    const { fake, user } = await setup();
    await user.click(setRow(/60 kg × 8/));

    await user.clear(within(dialog()).getByLabelText("Weight"));

    expect(within(dialog()).getByText("Required")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(requests(fake, "PATCH")).toHaveLength(0);
  });

  it("Delete set sends DELETE and drops the row without a refetch", async () => {
    const { fake, user } = await setup();
    const reads = activeReads(fake);
    await user.click(setRow(/60 kg × 8/));

    await deleteSetIn(user, dialog());

    await waitFor(() => expect(within(card()).queryByText("60 kg × 8")).not.toBeInTheDocument());
    expect(requests(fake, "DELETE")).toHaveLength(1);
    expect(within(card()).getByText("60 kg × 7")).toBeInTheDocument();
    expect(activeReads(fake)).toBe(reads);
    expect(screen.queryByRole("dialog", { name: /^Set/ })).not.toBeInTheDocument();
  });

  it("a delete that answers 404 removes the row too", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "DELETE", path: /\/sets\// }, () => problemResponse(404, "not-found"));
    await user.click(setRow(/60 kg × 8/));

    await deleteSetIn(user, dialog());

    await waitFor(() => expect(within(card()).queryByText("60 kg × 8")).not.toBeInTheDocument());
  });

  it("06.2 AC14 — 422 on save: the sheet closes, the row is marked 'Couldn't save' with Edit", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "PATCH", path: /\/sets\// }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "weight", message: "Too heavy" }] }),
    );
    await user.click(setRow(/60 kg × 8/));
    const weight = within(dialog()).getByLabelText("Weight");
    await user.clear(weight);
    await user.type(weight, "70");

    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog", { name: /^Set/ })).not.toBeInTheDocument();
    const failed = (await within(card()).findByText("Couldn't save")).closest("li")!;
    expect(within(failed).getByRole("button", { name: /^Edit set / })).toBeInTheDocument();
  });

  it("06.2 AC14 — a network failure on save keeps the new value pending; Retry now saves it", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "PATCH", path: /\/sets\// }, () => HttpResponse.error());
    await user.click(setRow(/60 kg × 8/));
    const weight = within(dialog()).getByLabelText("Weight");
    await user.clear(weight);
    await user.type(weight, "65");

    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(setRow(/65 kg × 8/)).toHaveTextContent("Not saved yet");
    await user.click(await screen.findByRole("button", { name: "Retry now" }));
    await waitFor(() => expect(setRow(/65 kg × 8/)).not.toHaveTextContent("Not saved yet"));
    expect(fake.state.active!.exercises[0]!.sets[0]!.weight).toBe(65);
  });

  it("06.2 AC14 — a network failure on delete removes the row at once; Retry now deletes it on the server", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "DELETE", path: /\/sets\// }, () => HttpResponse.error());
    await user.click(setRow(/60 kg × 8/));

    await deleteSetIn(user, dialog());

    expect(within(card()).queryByText("60 kg × 8")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Retry now" }));
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets.map((s) => s.reps)).toEqual([7]));
  });

  it("06.2 AC17 — 409 workout-finished on save marks the row failed", async () => {
    const { fake, user } = await setup();
    fake.failNext({ method: "PATCH", path: /\/sets\// }, () => problemResponse(409, "workout-finished"));
    await user.click(setRow(/60 kg × 8/));
    const weight = within(dialog()).getByLabelText("Weight");
    await user.clear(weight);
    await user.type(weight, "70");

    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(await within(card()).findByText("Couldn't save")).toBeInTheDocument();
  });

  it("the sheet always opens on the set that was tapped (second row)", async () => {
    const { user } = await setup();

    await user.click(setRow(/60 kg × 7/));

    expect(screen.getByRole("dialog", { name: "Set 2 · X" })).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Reps")).toHaveValue("7");
  });
});

describe("17.10 AC14, AC7 — the live set sheet uses the action row", () => {
  const rowNames = () => sheetRow().getAllByRole("button").map((b) => b.textContent);

  it("the row holds Delete set, Cancel, Save; the body holds none of them; one Cancel in the dialog", async () => {
    const { user } = await setup();
    await user.click(setRow(/60 kg × 8/));
    expect(rowNames()).toEqual(["Delete set", "Cancel", "Save"]);
    for (const name of ["Delete set", "Save", "Cancel"]) expect(within(sheetBody()).queryByRole("button", { name })).toBeNull();
    expect(within(dialog()).getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
  });

  it("the row's Save submits the form", async () => {
    const { fake, user } = await setup();
    await user.click(setRow(/60 kg × 8/));
    await user.type(within(dialog()).getByLabelText("Reps"), "{Control>}a{/Control}9");
    await user.click(sheetRow().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(requests(fake, "PATCH")).toHaveLength(1));
  });

  it("Cancel closes the sheet and sends nothing", async () => {
    const { fake, user } = await setup();
    await user.click(setRow(/60 kg × 8/));
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(requests(fake, "PATCH")).toHaveLength(0);
  });
});

describe("17.10 AC14 — 17.5's confirm sits in the row (Review Focus 2)", () => {
  const rowNames = () => sheetRow().getAllByRole("button").map((b) => b.textContent);
  async function asked() {
    const app = await setup();
    await app.user.click(setRow(/60 kg × 8/));
    await app.user.click(sheetRow().getByRole("button", { name: "Delete set" }));
    return app;
  }

  it("Keep set takes Delete set's place and focus; the confirm's Delete set takes Save's", async () => {
    await asked();
    const buttons = sheetRow().getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Keep set", "Cancel", "Delete set"]);
    expect(buttons[0]).toHaveFocus();
    expect(buttons[2]).toHaveAttribute("data-variant", "danger");
  });

  it("a second tap where Delete set was keeps the set", async () => {
    const { fake, user } = await asked();
    await user.click(sheetRow().getAllByRole("button")[0]!);
    expect(requests(fake, "DELETE")).toHaveLength(0);
    expect(rowNames()).toEqual(["Delete set", "Cancel", "Save"]);
  });

  it("Keep set is described by the question, which the status line says once", async () => {
    await asked();
    const question = "Delete set 1? 60 kg × 8 will be removed.";
    expect(sheetRow().getByRole("button", { name: "Keep set", description: question })).toBeInTheDocument();
    expect(sheetRow().getAllByText(question)).toHaveLength(1);
    expect(within(dialog()).getAllByText(question)).toHaveLength(1);
  });

  it("Cancel while asking closes the sheet and deletes nothing", async () => {
    const { fake, user } = await asked();
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(requests(fake, "DELETE")).toHaveLength(0);
  });

});
