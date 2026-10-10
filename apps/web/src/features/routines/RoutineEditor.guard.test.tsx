import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
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

import { makeRoutine, makeRoutineItem, routineId } from "../../test/workoutFixtures";
import { exerciseId } from "../../test/catalogFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { catalog, pushA } from "../../test/routineFixtures";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

const EDIT = `/app/workouts/routines/${routineId(1)}/edit`;

async function dirtyEditor() {
  prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
  const app = renderApp(`/app/workouts/routines/${routineId(1)}`);
  await screen.findByRole("heading", { level: 1, name: "Push A" });
  await act(() => app.router.navigate(EDIT));
  await app.user.type(await screen.findByLabelText("Notes"), "!");
  return app;
}

describe("10.0 AC34 — the leave guard", () => {
  it("Cancel while dirty asks; Keep editing stays; Discard leaves", async () => {
    const { router, user } = await dirtyEditor();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe(EDIT);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Discard changes?" })).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/routines/${routineId(1)}`));
  });

  it("a nav tab and the Back button are guarded too", async () => {
    const { router, user } = await dirtyEditor();
    await user.click(screen.getByRole("link", { name: "History" }));
    expect(await screen.findByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await act(() => router.navigate(-1));
    expect(await screen.findByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
  });

  it("a clean draft leaves silently; a successful save does not prompt", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    const { router, user } = renderApp(EDIT);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/routines/${routineId(1)}`));
    await act(() => router.navigate(EDIT));
    await user.type(await screen.findByLabelText("Notes"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/routines/${routineId(1)}`));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).toBeNull();
  });

  it("an adjusted load is dirty and guarded", async () => {
    const gapped = makeRoutine({
      id: routineId(6),
      name: "Gapped",
      items: [0, 1, 2, 3].map((position) => makeRoutineItem({ position, exerciseId: exerciseId(1), supersetGroup: position === 1 ? null : 1 })),
    });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [gapped] }) });
    const { user } = renderApp(`/app/workouts/routines/${routineId(6)}/edit`);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
  });

  it("registers a beforeunload prompt only while dirty", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    await dirtyEditor();
    const registered = add.mock.calls.filter(([type]) => type === "beforeunload");
    expect(registered).toHaveLength(1);
    const handler = registered[0]![1] as (e: Event) => void;
    const event = new Event("beforeunload", { cancelable: true });
    handler(event);
    expect(event.defaultPrevented).toBe(true);
    cleanup(); // unmount the editor
    expect(remove.mock.calls.some(([type, h]) => type === "beforeunload" && h === handler)).toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("10.0 AC35 — offline writes fail fast; nothing persists", () => {
  it("Save offline fails at once with the draft intact", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(EDIT);
    await user.type(await screen.findByLabelText("Notes"), "!");
    fake.setOffline(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("You're offline — your changes are still here, try again when connected")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("Heavy day!");
  });
});
