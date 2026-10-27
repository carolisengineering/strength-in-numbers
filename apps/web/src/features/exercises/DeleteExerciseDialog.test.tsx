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

import type { Exercise, Routine } from "@sin/core";
import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { makeProgressPoint, makeRoutine, makeRoutineItem, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse, type WorkoutFakeOptions } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { EXERCISES_COPY } from "./messages";
import { EXERCISES_PATH, exercisePath } from "./paths";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

const ID = "10000000-0000-4000-8000-0000000000f1";
const ORIGIN = "10000000-0000-4000-8000-0000000000f2";
const echo = makeExercise({ id: ID, name: "Echo Bike", ownerUserId: USER_ID, modality: "calories" });
const ROUTINES = /^\/v1\/exercises\/[^/]+\/routines$/;
const DELETE = /^\/v1\/exercises\/[^/]+$/;
const using = (n: number, name: string, extra: Record<string, unknown> = {}): Routine =>
  makeRoutine({ id: routineId(n), name, items: [makeRoutineItem({ exerciseId: ID })], ...extra });

function setup(options: { row?: Exercise; catalog?: Exercise[]; routines?: Routine[]; fake?: WorkoutFakeOptions } = {}) {
  const row = options.row ?? echo;
  const catalog = options.catalog ?? [row];
  const fake = createWorkoutFake({
    serveExercises: true,
    catalog,
    routines: options.routines ?? [],
    usage: [],
    progress: { [row.id]: [makeProgressPoint()] },
    ...options.fake,
  });
  prepareApp({ auth, fake, catalog });
  return { fake, ...renderApp(exercisePath(row.id)) };
}

async function openDelete(user: ReturnType<typeof setup>["user"], name = "Echo Bike") {
  await user.click(await screen.findByRole("button", { name: EXERCISES_COPY.deleteExercise }));
  return screen.findByRole("dialog", { name: EXERCISES_COPY.deleteTitle(name) });
}
const confirmButton = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Delete" });
const routineReads = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => ROUTINES.test(r.path));

describe("18.2 AC46 — the dialog opens and asks", () => {
  it("opening reads the routines; Delete waits for the answer; Cancel is focused; reopening asks again", async () => {
    const held = deferred<void>();
    const { fake, user } = setup();
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises/:id/routines`, async () => {
        await held.promise;
        return HttpResponse.json({ routines: [] });
      }),
    );
    const dialog = await openDelete(user);
    expect(within(dialog).getByText(EXERCISES_COPY.checkingRoutines)).toBeInTheDocument();
    expect(confirmButton(dialog)).toBeDisabled();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    held.resolve();
    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    server.resetHandlers();
    prepareAgain(fake);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const before = routineReads(fake).length;
    await openDelete(user);
    await waitFor(() => expect(routineReads(fake).length).toBe(before + 1));
  });
});

describe("18.2 AC46 / AC48 — a reopened dialog never shows the last answer", () => {
  it("reopening holds Delete until the fresh read answers, and a failed fresh read is a failure", async () => {
    const { fake, user } = setup();
    let dialog = await openDelete(user);
    await within(dialog).findByText(EXERCISES_COPY.deleteKeepsHistory);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // The routine list changed elsewhere; the fresh read is still out.
    const held = deferred<void>();
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises/:id/routines`, async () => {
        await held.promise;
        return HttpResponse.json({ routines: [{ id: routineId(1), name: "Cardio day", oneOffUntil: null }] });
      }),
    );
    dialog = await openDelete(user);
    expect(within(dialog).getByText(EXERCISES_COPY.checkingRoutines)).toBeInTheDocument();
    expect(within(dialog).queryByText(EXERCISES_COPY.deleteKeepsHistory)).toBeNull();
    expect(confirmButton(dialog)).toBeDisabled();
    held.resolve();
    expect(await within(dialog).findByText("Used in 1 routine:")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    server.resetHandlers();
    prepareAgain(fake);
    fake.failNext({ method: "GET", path: ROUTINES }, () => problemResponse(500, "internal"));
    dialog = await openDelete(user);
    expect(await within(dialog).findByText(EXERCISES_COPY.routinesCheckFailed)).toBeInTheDocument();
    expect(confirmButton(dialog)).toBeDisabled();
  });
});

/** After `server.resetHandlers()`, put the fake's handlers back. */
function prepareAgain(fake: ReturnType<typeof createWorkoutFake>) {
  server.use(...fake.handlers);
}

describe("18.2 AC47 — the warning names the routines", () => {
  it("no routine: the one sentence", async () => {
    const { user } = setup();
    const dialog = await openDelete(user);
    expect(await within(dialog).findByText(EXERCISES_COPY.deleteKeepsHistory)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Used in/)).toBeNull();
  });

  it("one routine: This routine shows…", async () => {
    const { user } = setup({ routines: [using(1, "Cardio day")] });
    const dialog = await openDelete(user);
    expect(await within(dialog).findByText("Used in 1 routine:")).toBeInTheDocument();
    expect(within(dialog).getByRole("list")).toHaveTextContent("Cardio day");
    expect(within(dialog).getByText(EXERCISES_COPY.routinesBreak(1))).toBeInTheDocument();
  });

  it("seven: five names in the server's order, then and 2 more; a one-off is labeled; markup stays text", async () => {
    const routines = [
      using(1, "a"),
      using(2, "B"),
      using(3, "c", { oneOffUntil: "2026-11-08T00:00:00.000Z" }),
      using(4, "<b>Push</b>"),
      using(5, "e"),
      using(6, "f"),
      using(7, "g"),
    ];
    const { user } = setup({ routines });
    const dialog = await openDelete(user);
    expect(await within(dialog).findByText("Used in 7 routines:")).toBeInTheDocument();
    const items = within(within(dialog).getByRole("list")).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["<b>Push</b>", "a", "B", "c (one-off)", "e"]);
    expect(within(dialog).queryByText("Push", { selector: "b" })).toBeNull();
    expect(within(dialog).getByText("and 2 more")).toBeInTheDocument();
    expect(within(dialog).getByText(EXERCISES_COPY.routinesBreak(7))).toBeInTheDocument();
  });
});

describe("18.2 AC48 — the check fails", () => {
  it("a 500: the text and Try again; Delete stays disabled until the answer is in", async () => {
    const { fake, user } = setup({ routines: [using(1, "Cardio day")] });
    fake.failNext({ method: "GET", path: ROUTINES }, () => problemResponse(500, "internal"));
    const dialog = await openDelete(user);
    expect(await within(dialog).findByText(EXERCISES_COPY.routinesCheckFailed)).toBeInTheDocument();
    expect(confirmButton(dialog)).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: EXERCISES_COPY.tryAgain }));
    expect(await within(dialog).findByText("Used in 1 routine:")).toBeInTheDocument();
    expect(confirmButton(dialog)).toBeEnabled();
  });
});

describe("18.2 AC49 — the sentence for a copy", () => {
  const copy = makeExercise({ id: ID, name: "My bench", ownerUserId: USER_ID, forkedFromExerciseId: ORIGIN });
  const origin = makeExercise({ id: ORIGIN, name: "Bench Press", ownerUserId: null });

  it("names the built-in that comes back, and none of its routines", async () => {
    const routines = [makeRoutine({ id: routineId(9), name: "Origin day", items: [makeRoutineItem({ exerciseId: ORIGIN })] })];
    const { user } = setup({ row: copy, catalog: [origin, copy], routines });
    const dialog = await openDelete(user, "My bench");
    expect(await within(dialog).findByText(EXERCISES_COPY.copyComesBack("Bench Press"))).toBeInTheDocument();
    expect(within(dialog).queryByText(/Origin day/)).toBeNull();
  });

  it("falls back when the built-in is not in the store", async () => {
    const { user } = setup({ row: copy, catalog: [copy] });
    const dialog = await openDelete(user, "My bench");
    expect(await within(dialog).findByText(EXERCISES_COPY.copyComesBack(null))).toBeInTheDocument();
  });
});

describe("18.2 AC50 — confirm and after", () => {
  it("busy while the delete is out; lands on the list with Deleted …, state cleared, focus on the title; never the deleted page", async () => {
    const held = deferred<void>();
    const { fake, user, router } = setup({ routines: [using(1, "Cardio day")] });
    const dialog = await openDelete(user);
    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    server.use(
      http.delete(`${API_BASE_URL}/v1/exercises/:id`, async () => {
        await held.promise;
        fake.state.catalog.splice(0, 1, { ...echo, isActive: false });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await user.click(confirmButton(dialog));
    expect(confirmButton(dialog)).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByText(EXERCISES_COPY.deleted)).toBeNull();
    held.resolve();
    await waitFor(() => expect(router.state.location.pathname).toBe(EXERCISES_PATH));
    expect(screen.queryByText(EXERCISES_COPY.deleted)).toBeNull();
    expect(router.state.historyAction).toBe("REPLACE");
    expect(await screen.findByText("Deleted Echo Bike.")).toHaveAttribute("role", "status");
    await waitFor(() => expect(router.state.location.state).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Exercises" })));
    expect(screen.queryByRole("link", { name: /^Echo Bike/ })).toBeNull();
    expect(observability.track).toHaveBeenCalledWith("custom_exercise_deleted", { routineCount: 1 });
  });

  it("a 404 is success; the row leaves the list before any refresh lands (deferred minor 124)", async () => {
    const sync = deferred<void>();
    const { fake, user, router } = setup();
    const dialog = await openDelete(user);
    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    // Already deleted elsewhere: the server answers 404, and the refresh that follows is held.
    fake.failNext({ method: "DELETE", path: DELETE }, () => {
      fake.state.catalog.splice(0, 1, { ...echo, isActive: false });
      return problemResponse(404, "not-found");
    });
    server.use(
      http.get(`${API_BASE_URL}/v1/exercises`, async () => {
        await sync.promise;
      }),
    );
    await user.click(confirmButton(dialog));
    await waitFor(() => expect(router.state.location.pathname).toBe(EXERCISES_PATH));
    expect(await screen.findByText("Deleted Echo Bike.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Echo Bike/ })).toBeNull();
    sync.resolve();
  });

  it("deferred minor 127 — a 403 exercise-immutable: the delete wording, after a forced refresh", async () => {
    const { fake, user } = setup();
    fake.failNext({ method: "DELETE", path: DELETE }, () => problemResponse(403, "exercise-immutable"));
    const dialog = await openDelete(user);
    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    const before = fake.requests.length;
    await user.click(confirmButton(dialog));
    expect(await screen.findByText(EXERCISES_COPY.builtInCantDelete)).toBeInTheDocument();
    expect(screen.queryByText(EXERCISES_COPY.builtInCantEdit)).toBeNull();
    await waitFor(() => expect(fake.requests.slice(before).some((r) => r.method === "GET" && r.path === "/v1/exercises")).toBe(true));
  });

  it("deferred minor 125 — Escape while the delete is out leaves the dialog up", async () => {
    const held = deferred<void>();
    const { user, router } = setup();
    const dialog = await openDelete(user);
    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    server.use(
      http.delete(`${API_BASE_URL}/v1/exercises/:id`, async () => {
        await held.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await user.click(confirmButton(dialog));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog", { name: EXERCISES_COPY.deleteTitle("Echo Bike") })).toBeInTheDocument();
    held.resolve();
    await waitFor(() => expect(router.state.location.pathname).toBe(EXERCISES_PATH));
    expect(await screen.findByText("Deleted Echo Bike.")).toBeInTheDocument();
    await screen.findByRole("list", { name: EXERCISES_COPY.listLabel });
  });

  it("deferred minor 129 — the Deleted line clears on the first search keystroke", async () => {
    const { user, router } = setup({ catalog: [echo, makeExercise({ id: ORIGIN, name: "Row", ownerUserId: null })] });
    const dialog = await openDelete(user);
    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    await user.click(confirmButton(dialog));
    await waitFor(() => expect(router.state.location.pathname).toBe(EXERCISES_PATH));
    const notice = await screen.findByText("Deleted Echo Bike.");
    await user.type(await screen.findByRole("searchbox", { name: EXERCISES_COPY.searchLabel }), "r");
    expect(notice).toBeEmptyDOMElement();
  });

  it("a 429 closes the dialog and shows the text on the page", async () => {
    const { fake, user, router } = setup();
    fake.failNext({ method: "DELETE", path: DELETE }, () => problemResponse(429, "rate-limited"));
    const dialog = await openDelete(user);
    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    await user.click(confirmButton(dialog));
    expect(await screen.findByText(EXERCISES_COPY.tooFast)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: EXERCISES_COPY.deleteTitle("Echo Bike") })).toBeNull());
    expect(router.state.location.pathname).toBe(exercisePath(ID));
  });
});

describe("18.2 AC54 — focus (Delete)", () => {
  it("Cancel is focused on open; after Cancel focus is back on Delete exercise", async () => {
    const { user } = setup();
    const dialog = await openDelete(user);
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    await user.click(cancel);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: EXERCISES_COPY.deleteExercise })));
  });
});
