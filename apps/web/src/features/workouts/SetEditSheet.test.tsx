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

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

async function setup() {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({
      exercises: [
        {
          modality: "weight_reps",
          name: "X",
          sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 }), makeSet({ setNumber: 2, weight: 60, reps: 7 })],
        },
      ],
    }),
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

describe("AC25 — edit and delete a logged set", () => {
  it("tapping a row opens a sheet titled with the set number and exercise, fields prefilled", async () => {
    const { user } = await setup();

    await user.click(setRow(/60 kg × 8/));

    const sheet = screen.getByRole("dialog", { name: "Set 1 · X" });
    expect(within(sheet).getByLabelText("Weight")).toHaveValue("60");
    expect(within(sheet).getByLabelText("Reps")).toHaveValue("8");
    expect(within(sheet).getByLabelText("Weight unit")).toHaveValue("kg");
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

    await user.selectOptions(within(dialog()).getByLabelText("Weight unit"), "lb");
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

    await user.click(within(dialog()).getByRole("button", { name: "Delete set" }));

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

    await user.click(within(dialog()).getByRole("button", { name: "Delete set" }));

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
    expect(within(failed).getByRole("button", { name: "Edit" })).toBeInTheDocument();
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

    await user.click(within(dialog()).getByRole("button", { name: "Delete set" }));

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
