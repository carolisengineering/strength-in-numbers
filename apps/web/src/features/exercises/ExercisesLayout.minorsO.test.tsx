import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
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

import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { makeExercise } from "../../test/catalogFixtures";
import { resetDesktop, setDesktop } from "../../test/desktop";
import { server } from "../../test/msw/server";
import { makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { EXERCISES_COPY } from "./messages";
import { EXERCISES_PATH } from "./paths";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 20, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  resetDesktop();
  cleanupApp();
});

const ECHO = "10000000-0000-4000-8000-0000000000c1";
const BENCH = "10000000-0000-4000-8000-0000000000c2";
const echo = makeExercise({ id: ECHO, name: "Echo Bike", ownerUserId: USER_ID, modality: "calories" });
const bench = makeExercise({ id: BENCH, name: "Barbell bench press", ownerUserId: null });
const on = (...dates: string[]) => dates.map((localDate) => makeProgressPoint({ localDate }));
/** Echo Bike is the most recently logged, so bare /app/exercises opens it at desktop widths. */
const PROGRESS = { [ECHO]: on("2026-10-10"), [BENCH]: on("2026-09-01") };
const DELETE = /^\/v1\/exercises\/[^/]+$/;

const panes = () => [...document.querySelectorAll<HTMLElement>("[data-pane]")];
const detailPane = () => panes()[1]!;
const listPane = () => panes()[0]!;

async function setup(path: string, wide: boolean) {
  // Installed either way, so a later flip reaches the app's listeners.
  setDesktop(wide);
  const catalog = [echo, bench];
  const fake = createWorkoutFake({ serveExercises: true, catalog, routines: [], progress: PROGRESS });
  prepareApp({ auth, fake, catalog });
  const app = renderApp(path);
  if (wide) await waitFor(() => expect(panes()).toHaveLength(2));
  return { fake, ...app };
}

async function openDelete(user: ReturnType<typeof renderApp>["user"]) {
  await within(detailPane()).findByRole("heading", { level: 1, name: "Echo Bike" });
  await user.click(await within(detailPane()).findByRole("button", { name: EXERCISES_COPY.deleteExercise }));
  const dialog = await screen.findByRole("dialog", { name: EXERCISES_COPY.deleteTitle("Echo Bike") });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Delete" })).toBeEnabled());
  return dialog;
}

describe("18.2 AC50 — minor 659: deleting the exercise opened by default keeps drawing it until the navigation", () => {
  it("wide, bare /app/exercises: the page and dialog are still there when the navigation lands; then the list's notice and focus", async () => {
    const { fake, user, router } = await setup(EXERCISES_PATH, true);
    const dialog = await openDelete(user);
    const held = deferred<void>();
    server.use(
      http.delete(`${API_BASE_URL}/v1/exercises/:id`, async () => {
        await held.promise;
        fake.state.catalog.splice(0, 1, { ...echo, isActive: false });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    // What the screen holds at the moment the delete's navigation lands.
    const atNavigation: { title: boolean; dialog: boolean; body: boolean }[] = [];
    const stop = router.subscribe((state) => {
      if (state.location.state === null || (state.location.state as { notice?: string }).notice !== "deleted") return;
      atNavigation.push({
        title: within(detailPane()).queryByRole("heading", { level: 1, name: "Echo Bike" }) !== null,
        dialog: dialog.isConnected,
        body: document.activeElement === document.body,
      });
    });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(within(detailPane()).getByRole("heading", { level: 1, name: "Echo Bike" })).toBeInTheDocument();
    held.resolve();
    expect(await within(listPane()).findByText("Deleted Echo Bike.")).toHaveAttribute("role", "status");
    stop();
    expect(atNavigation[0]).toEqual({ title: true, dialog: true, body: false });
    await waitFor(() => expect(document.activeElement).toBe(within(listPane()).getByRole("heading", { name: "Exercises" })));
    await within(detailPane()).findByRole("heading", { level: 1, name: "Barbell bench press" });
  });

  it("Review Focus 3: a failed delete releases the hold; the page stays with its error, and a later refresh moves the selection on", async () => {
    const { fake, user } = await setup(EXERCISES_PATH, true);
    const dialog = await openDelete(user);
    fake.failNext({ method: "DELETE", path: DELETE }, () => problemResponse(500, "internal"));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await within(detailPane()).findByText(EXERCISES_COPY.couldntSave);
    expect(within(detailPane()).getByRole("heading", { level: 1, name: "Echo Bike" })).toBeInTheDocument();
    // Gone elsewhere; the next sync drops it, and the derived selection follows.
    fake.state.catalog.splice(0, 1, { ...echo, isActive: false });
    await user.click(within(listPane()).getByRole("link", { name: /^Barbell bench press/ }));
    await within(detailPane()).findByRole("heading", { level: 1, name: "Barbell bench press" });
  });
});

describe("minor 662 — the Exercises search survives a resize across 64rem", () => {
  const search = () => screen.getByRole("searchbox");

  it("type on the phone, widen: the list pane keeps it; narrow again: still there", async () => {
    const { user } = await setup(EXERCISES_PATH, false);
    await user.type(await screen.findByRole("searchbox"), "bench");
    act(() => setDesktop(true));
    await waitFor(() => expect(panes()).toHaveLength(2));
    expect(within(listPane()).getByRole("searchbox")).toHaveValue("bench");
    act(() => setDesktop(false));
    await waitFor(() => expect(panes()).toHaveLength(0));
    expect(search()).toHaveValue("bench");
  });

  it("Review Focus 4: on the phone, open a result and come Back: the search is empty, as today", async () => {
    const { user, router } = await setup(EXERCISES_PATH, false);
    await user.type(await screen.findByRole("searchbox"), "bench");
    await user.click(await screen.findByRole("link", { name: /^Barbell bench press/ }));
    await screen.findByRole("heading", { level: 1, name: "Barbell bench press" });
    await act(() => router.navigate(-1));
    expect(await screen.findByRole("searchbox")).toHaveValue("");
  });
});
