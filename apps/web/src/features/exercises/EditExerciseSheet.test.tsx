import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

import { MODALITY_VALUES, type Exercise } from "@sin/core";
import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse, type WorkoutFakeOptions } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { MODALITY_LABELS } from "../catalog/labels";
import { EXERCISES_COPY } from "./messages";
import { exercisePath } from "./paths";

afterEach(() => {
  observability.reportError.mockReset();
  cleanupApp();
});

const ID = "10000000-0000-4000-8000-0000000000c1";
const PATCH = /^\/v1\/exercises\/[^/]+$/;
const own = makeExercise({ id: ID, name: "Echo Bike", ownerUserId: USER_ID, modality: "weight_reps", primaryMuscleId: null, secondaryMuscleIds: [], equipmentId: null });
const LOGGED = [{ rootId: ID, lastLoggedOn: "2026-10-06" }];

function setup(options: { row?: Exercise; fake?: WorkoutFakeOptions } = {}) {
  const row = options.row ?? own;
  const fake = createWorkoutFake({ serveExercises: true, catalog: [row], usage: [], progress: { [row.id]: [makeProgressPoint()] }, ...options.fake });
  prepareApp({ auth, fake, catalog: [row] });
  return { fake, ...renderApp(exercisePath(row.id)) };
}

const openEdit = async (user: ReturnType<typeof setup>["user"]) => {
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  return screen.findByRole("dialog", { name: "Edit exercise" });
};
const typeRadio = (sheet: HTMLElement, m: (typeof MODALITY_VALUES)[number]) => within(sheet).getByRole("radio", { name: MODALITY_LABELS[m] });
const patches = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "PATCH" && PATCH.test(r.path));

describe("18.2 AC35 — the sheet", () => {
  it("opens prefilled with More details open; Save waits for a change and a name", async () => {
    const { user } = setup();
    const sheet = await openEdit(user);
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Echo Bike");
    expect(typeRadio(sheet, "weight_reps")).toBeChecked();
    expect(sheet.querySelector("details")).toHaveAttribute("open");
    const save = within(sheet).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.type(within(sheet).getByLabelText("Name"), " 2");
    expect(save).toBeEnabled();
    await user.clear(within(sheet).getByLabelText("Name"));
    expect(save).toBeDisabled();
  });

  it("Escape does nothing while a save is in flight; Cancel discards", async () => {
    const held = deferred<void>();
    const { user } = setup();
    let sheet = await openEdit(user);
    await user.type(within(sheet).getByLabelText("Name"), " 2");
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit exercise" })).toBeNull());
    sheet = await openEdit(user);
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Echo Bike");

    server.use(
      http.patch(`${API_BASE_URL}/v1/exercises/:id`, async () => {
        await held.promise;
        return HttpResponse.json({ ...own, name: "Echo Bike 2" });
      }),
    );
    await user.type(within(sheet).getByLabelText("Name"), " 2");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    fireEvent(sheet, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog", { name: "Edit exercise" })).toBeInTheDocument();
    held.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit exercise" })).toBeNull());
  });
});

describe("18.2 AC37 — options on screen", () => {
  it("logged: only the compatible types are enabled, with the note", async () => {
    const { user } = setup({ fake: { usage: LOGGED } });
    const sheet = await openEdit(user);
    await waitFor(() => expect(typeRadio(sheet, "calories")).toBeDisabled());
    const enabled = MODALITY_VALUES.filter((m) => !typeRadio(sheet, m).hasAttribute("disabled"));
    expect(enabled).toEqual(["weight_reps", "weighted_bodyweight"]);
    expect(within(sheet).getByText(EXERCISES_COPY.typeLimitedTo("Weighted bodyweight"))).toBeInTheDocument();
  });

  it("never logged: all eight enabled, no note", async () => {
    const { user } = setup();
    const sheet = await openEdit(user);
    await waitFor(() => expect(MODALITY_VALUES.every((m) => !typeRadio(sheet, m).hasAttribute("disabled"))).toBe(true));
    expect(within(sheet).queryByText(/has logged sets/)).toBeNull();
  });
});

describe("18.2 AC38 — usage on open", () => {
  it("opening asks again; while held the checking note shows", async () => {
    const held = deferred<void>();
    const { fake, user } = setup();
    await screen.findByRole("heading", { level: 1, name: "Echo Bike" });
    await waitFor(() => expect(fake.requests.filter((r) => r.path === "/v1/exercises/usage")).toHaveLength(1));
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises/usage`, async () => {
        await held.promise;
        return HttpResponse.json({ exercises: [] });
      }),
    );
    let asked = 0;
    server.events.on("request:start", ({ request }) => {
      if (new URL(request.url).pathname === "/v1/exercises/usage") asked += 1;
    });
    await openEdit(user);
    await waitFor(() => expect(asked).toBe(1));
    server.events.removeAllListeners("request:start");
    held.resolve();
  });

  it("pending from the start: the checking note; failed: the failed note, and a muscle edit saves without the type", async () => {
    const fake = createWorkoutFake({ serveExercises: true, catalog: [own], usage: [], progress: { [ID]: [makeProgressPoint()] } });
    fake.failNext({ method: "GET", path: /^\/v1\/exercises\/usage$/ }, () => problemResponse(500, "internal"), 5);
    prepareApp({ auth, fake, catalog: [own] });
    const { user } = renderApp(exercisePath(ID));
    const sheet = await openEdit(user);
    expect(await within(sheet).findByText(EXERCISES_COPY.typeCheckFailed)).toBeInTheDocument();
    expect(MODALITY_VALUES.filter((m) => m !== "weight_reps").every((m) => typeRadio(sheet, m).hasAttribute("disabled"))).toBe(true);
    expect(typeRadio(sheet, "weight_reps")).toBeChecked();
    await user.selectOptions(within(sheet).getByLabelText("Primary muscle"), "chest");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches(fake)).toHaveLength(1));
    expect(patches(fake)[0]!.body).toEqual({ primaryMuscleId: "chest" });
  });

  it("the checking note shows while the first usage read is still out", async () => {
    const held = deferred<void>();
    const fake = createWorkoutFake({ serveExercises: true, catalog: [own], usage: [], progress: { [ID]: [makeProgressPoint()] } });
    prepareApp({ auth, fake, catalog: [own] });
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises/usage`, async () => {
        await held.promise;
        return HttpResponse.json({ exercises: [] });
      }),
    );
    const { user } = renderApp(exercisePath(ID));
    const sheet = await openEdit(user);
    expect(within(sheet).getByText(EXERCISES_COPY.typeChecking)).toBeInTheDocument();
    held.resolve();
  });
});

describe("18.2 AC40 — rename and success", () => {
  it("the rename note; a rename sends { name } only; Saved., new title, caches refreshed; reopening clears the status", async () => {
    const { fake, user, queryClient } = setup({ fake: { usage: LOGGED } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const sheet = await openEdit(user);
    expect(within(sheet).getByText(EXERCISES_COPY.renameNote)).toBeInTheDocument();
    await waitFor(() => expect(typeRadio(sheet, "calories")).toBeDisabled());
    await user.clear(within(sheet).getByLabelText("Name"));
    await user.type(within(sheet).getByLabelText("Name"), "Assault Bike");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Assault Bike" })).toBeInTheDocument();
    expect(patches(fake)[0]!.body).toEqual({ name: "Assault Bike" });
    expect(screen.queryByRole("dialog", { name: "Edit exercise" })).toBeNull();
    expect(screen.getByText(EXERCISES_COPY.saved)).toHaveAttribute("role", "status");
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual(expect.arrayContaining([["records"], ["progress"]]));
    await openEdit(user);
    expect(screen.queryByText(EXERCISES_COPY.saved)).toBeNull();
  });
});

describe("18.2 AC41 — type locked", () => {
  it("keeps the sheet and the other edits, resets the type, explains, re-reads usage; a second Save succeeds", async () => {
    const { fake, user } = setup();
    const sheet = await openEdit(user);
    await waitFor(() => expect(typeRadio(sheet, "calories")).toBeEnabled());
    // Another device logged a set meanwhile: the server's usage says logged.
    fake.failNext({ method: "PATCH", path: PATCH }, () => problemResponse(409, "exercise-type-locked"));
    const usageBefore = fake.requests.filter((r) => r.path === "/v1/exercises/usage").length;
    await user.type(within(sheet).getByLabelText("Name"), " Pro");
    await user.click(typeRadio(sheet, "calories"));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText(EXERCISES_COPY.typeLocked)).toBeInTheDocument();
    expect(typeRadio(sheet, "weight_reps")).toBeChecked();
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Echo Bike Pro");
    await waitFor(() => expect(fake.requests.filter((r) => r.path === "/v1/exercises/usage").length).toBeGreaterThan(usageBefore));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Echo Bike Pro" })).toBeInTheDocument();
    expect(patches(fake).at(-1)!.body).toEqual({ name: "Echo Bike Pro" });
  });
});

describe("18.2 AC42 — other errors on screen", () => {
  const rename = async (user: ReturnType<typeof setup>["user"]) => {
    const sheet = await openEdit(user);
    await user.type(within(sheet).getByLabelText("Name"), " 2");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    return sheet;
  };

  it("422: the message under its field, details open", async () => {
    const { fake, user } = setup();
    fake.failNext({ method: "PATCH", path: PATCH }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "secondaryMuscleIds.0", message: "Unknown muscle" }] }),
    );
    const sheet = await rename(user);
    expect(await within(sheet).findByText("Unknown muscle")).toBeInTheDocument();
    expect(sheet.querySelector("details")).toHaveAttribute("open");
  });

  it("409 exercise-retired: the sheet closes and the page is the deleted variant", async () => {
    const { fake, user } = setup();
    const sheet = await openEdit(user);
    fake.failNext({ method: "PATCH", path: PATCH }, () => problemResponse(409, "exercise-retired"));
    // Another device deleted it: the forced refresh learns the row is gone.
    fake.state.catalog.splice(0, 1, { ...own, isActive: false });
    await user.type(within(sheet).getByLabelText("Name"), " 2");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(EXERCISES_COPY.deleted)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit exercise" })).toBeNull();
    expect(screen.getByText(EXERCISES_COPY.alreadyDeleted)).toBeInTheDocument();
  });

  it.each([
    ["409 exercise-immutable-use-fork", () => problemResponse(409, "exercise-immutable-use-fork"), EXERCISES_COPY.builtInCantEdit],
    ["offline", () => HttpResponse.error(), EXERCISES_COPY.offline],
    ["429", () => problemResponse(429, "rate-limited"), EXERCISES_COPY.tooFast],
    ["500", () => problemResponse(500, "internal"), EXERCISES_COPY.couldntSave],
  ])("%s: the form message, nothing reported", async (_label, fail, text) => {
    const { fake, user } = setup();
    fake.failNext({ method: "PATCH", path: PATCH }, fail);
    const sheet = await rename(user);
    expect(await within(sheet).findByText(text)).toBeInTheDocument();
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("401: no text", async () => {
    const { fake, user } = setup();
    // The client refreshes the token and retries once; both answers are 401.
    fake.failNext({ method: "PATCH", path: PATCH }, () => problemResponse(401, "unauthenticated"), 2);
    await rename(user);
    await waitFor(() => expect(patches(fake)).toHaveLength(2));
    // The 401 starts the sign-out (`onAuthLost`); the sheet adds no message of its own.
    for (const text of [EXERCISES_COPY.couldntSave, EXERCISES_COPY.offline, EXERCISES_COPY.tooFast]) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });

  it("an unexpected failure: the fallback text, reported once with static tags", async () => {
    const { fake, user } = setup();
    fake.failNext({ method: "PATCH", path: PATCH }, () => problemResponse(418, "teapot"));
    const sheet = await rename(user);
    expect(await within(sheet).findByText(EXERCISES_COPY.couldntSave)).toBeInTheDocument();
    await waitFor(() => expect(observability.reportError).toHaveBeenCalledTimes(1));
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "workouts", op: "update-exercise" });
  });
});

describe("18.2 AC54 — focus and status (Edit)", () => {
  it("the status region is there and empty; after Save focus returns to Edit", async () => {
    const { user } = setup();
    await screen.findByRole("heading", { level: 1, name: "Echo Bike" });
    const status = document.querySelector("[data-testid='exercise-status']");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("");
    const sheet = await openEdit(user);
    await user.type(within(sheet).getByLabelText("Name"), " 2");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { level: 1, name: "Echo Bike 2" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" })));
  });
});
