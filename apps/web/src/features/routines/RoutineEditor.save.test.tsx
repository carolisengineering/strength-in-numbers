import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { HttpResponse } from "msw";
import { exerciseId } from "../../test/catalogFixtures";
import { makeRoutine, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { addFromPicker } from "../../test/routineHarness";
import { catalog, pushA } from "../../test/routineFixtures";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.reportError.mockReset();
  cleanupApp();
});

const writes = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => (r.method === "POST" || r.method === "PUT") && r.path.startsWith("/v1/routines"));

async function newRoutine(user: ReturnType<typeof renderApp>["user"], name = "Legs") {
  await screen.findByRole("heading", { level: 1, name: "New routine" });
  await user.type(screen.getByLabelText("Name"), name);
  await addFromPicker(user, /Bench Press/);
}

describe("10.0 AC31 — Save gating and messages", () => {
  it("a pristine new routine shows no errors; Save is disabled", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog }) });
    renderApp("/app/workouts/routines/new");
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("each reason sits on its element", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog }) });
    const { user } = renderApp("/app/workouts/routines/new");
    await screen.findByRole("heading", { level: 1, name: "New routine" });
    await user.type(screen.getByLabelText("Name"), "x");
    await user.clear(screen.getByLabelText("Name"));
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/Give the routine a name/);
    expect(screen.getByText("Add at least one exercise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("10.0 AC8 — duplicate-name warning in the editor", () => {
  it("warns as you type but keeps Save enabled", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    const { user } = renderApp("/app/workouts/routines/new");
    await newRoutine(user, "push a");
    expect(screen.getByText("You already have a routine with this name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("Review Focus 4 — renaming to a case variant of itself is fine", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "push a");
    expect(screen.queryByText("You already have a routine with this name")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/routines/${routineId(1)}`));
    expect(fake.state.routines.get(routineId(1))?.name).toBe("push a");
  });
});

describe("10.0 AC32 — save success and navigation", () => {
  it("create: POST body equals the draft's payload; navigates (replace) to the new preview; one request on double tap", async () => {
    const fake = createWorkoutFake({ catalog });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp("/app/workouts/routines/new");
    await newRoutine(user);
    await addFromPicker(user, /Bench Press/); // a repeated exercise
    await addFromPicker(user, /Barbell Row/);
    const list = screen.getByRole("list", { name: "Exercises" });
    await user.click(within(list).getByRole("button", { name: "Superset Bench Press with Barbell Row" }));
    await user.click(within(list).getAllByRole("button", { name: /^Bench Press/ })[0]!);
    await user.type(screen.getByLabelText("Sets"), "3");
    await user.selectOptions(screen.getByLabelText("RPE"), "8.5");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.dblClick(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/workouts\/routines\/[0-9a-f-]{36}$/));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(writes(fake)).toHaveLength(1);
    expect(writes(fake)[0]!.body).toEqual({
      name: "Legs",
      items: [
        { exerciseId: exerciseId(1), targetSets: 3, targetRepsLow: null, targetRepsHigh: null, targetRpe: 8.5, restSeconds: null, supersetGroup: null },
        { exerciseId: exerciseId(1), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null, supersetGroup: 1 },
        { exerciseId: exerciseId(2), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null, supersetGroup: 1 },
      ],
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Legs" })).toBeInTheDocument();
  });

  it("edit: PUT the whole document and return to the preview", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    await user.type(await screen.findByLabelText("Notes"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/routines/${routineId(1)}`));
    expect(writes(fake)[0]).toMatchObject({ method: "PUT", path: `/v1/routines/${routineId(1)}` });
    expect((writes(fake)[0]!.body as { items: unknown[] }).items).toHaveLength(3);
  });
});

describe("10.0 AC33 / AC17 — save failures keep the draft", () => {
  async function failing(response: () => Response) {
    const fake = createWorkoutFake({ catalog });
    fake.failNext({ method: "POST", path: /^\/v1\/routines$/ }, response);
    prepareApp({ auth, catalog, fake });
    const app = renderApp("/app/workouts/routines/new");
    await newRoutine(app.user);
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    return { ...app, fake };
  }

  it("name taken → on the name field, focused", async () => {
    await failing(() => problemResponse(409, "routine-name-taken"));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/You already have a routine with this name/);
    expect(screen.getByLabelText("Name")).toHaveValue("Legs");
  });

  it("limit → the limit text", async () => {
    await failing(() => problemResponse(409, "routine-limit"));
    expect(await screen.findByText("You've reached 50 routines — delete one to add another")).toBeInTheDocument();
  });

  it("retired → marks the submitted row and blocks Save", async () => {
    await failing(() => problemResponse(409, "exercise-retired", { errors: [{ path: "items.0.exerciseId", message: "x" }] }));
    expect(await screen.findByText("No longer available — remove or replace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("422 → mapped onto the field and reported", async () => {
    await failing(() => problemResponse(422, "validation-error", { errors: [{ path: "items.0.restSeconds", message: "x" }, { path: "weird", message: "y" }] }));
    expect(await screen.findByText("Check the rest — up to 15:00")).toBeInTheDocument();
    expect(screen.getByText("Something in this routine can't be saved — check it and try again")).toBeInTheDocument();
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "routines", op: "save-routine" });
  });

  it.each([
    [() => problemResponse(429, "rate-limited"), "Too many changes in a short time — wait a minute and try again"],
    [() => HttpResponse.error(), "You're offline — your changes are still here, try again when connected"],
    [() => problemResponse(500, "internal"), "Couldn't save this routine — try again."],
  ])("other failure → its message, draft intact", async (response, text) => {
    await failing(response);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Legs");
  });

  it("404 on edit → gone notice, Save disabled", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    await user.type(await screen.findByLabelText("Notes"), "!");
    fake.state.routines.clear();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That routine no longer exists")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Workouts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("10.0 AC32 — a save in flight", () => {
  it("locks the form, so nothing typed during a slow save can be lost", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fake.failNext({ method: "PUT", path: /^\/v1\/routines\// }, (() => gate.then(() => problemResponse(500, "internal"))) as unknown as () => Response);
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    await user.type(await screen.findByLabelText("Notes"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    expect(screen.getByLabelText("Notes")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeDisabled();
    for (const button of within(screen.getByRole("list", { name: "Exercises" })).getAllByRole("button")) expect(button).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
  });

  it("a save that lands after the lifter discarded and left does not move them", async () => {
    const fake = createWorkoutFake({ catalog });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const created = new Promise<void>((resolve) => {
      fake.failNext({ method: "POST", path: /^\/v1\/routines$/ }, (() =>
        gate.then(() => {
          resolve();
          return HttpResponse.json(makeRoutine({ id: routineId(7), name: "Legs" }), { status: 201 });
        })) as unknown as () => Response);
    });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp("/app/workouts/routines/new");
    await newRoutine(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Discard changes?" })).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
    release();
    await created;
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe("/app/workouts");
  });
});
