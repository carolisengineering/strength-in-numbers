import { act, screen, waitFor, within } from "@testing-library/react";
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

import { ROUTINE_ITEMS_MAX } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { makeRoutine, makeRoutineItem, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { addFromPicker } from "../../test/routineHarness";
import { catalog, pushA } from "../../test/routineFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

describe("10.0 AC25 — editor shell and loading", () => {
  it("create: empty draft, h1 New routine, Cancel, fields, Add exercise, no request", async () => {
    const fake = createWorkoutFake({ catalog });
    prepareApp({ auth, catalog, fake });
    renderApp("/app/workouts/routines/new");
    expect(await screen.findByRole("heading", { level: 1, name: "New routine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Notes")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeEnabled();
    expect(fake.requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("edit: loads the routine as the preview does; 404 says it no longer exists", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    const { router } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    expect(await screen.findByLabelText("Name")).toHaveValue("Push A");
    expect(screen.getByRole("heading", { level: 1, name: "Edit routine" })).toBeInTheDocument();
    await act(() => router.navigate(`/app/workouts/routines/${routineId(9)}/edit`));
    expect(await screen.findByText("That routine no longer exists")).toBeInTheDocument();
  });

  it("a background refetch never clobbers the draft", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { queryClient, user } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Push Heavy");
    fake.state.routines.set(routineId(1), { ...pushA, name: "Changed elsewhere" });
    await act(() => queryClient.refetchQueries({ queryKey: ["routines", "list"] }));
    expect(screen.getByLabelText("Name")).toHaveValue("Push Heavy");
  });
});

describe("10.0 AC26 — adding exercises", () => {
  it("appends from the picker, closes it, allows duplicates", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog }) });
    const { user } = renderApp("/app/workouts/routines/new");
    await screen.findByRole("heading", { level: 1, name: "New routine" });
    await addFromPicker(user, /Bench Press/);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add exercise" })).toBeNull());
    await addFromPicker(user, /Bench Press/);
    const rows = within(screen.getByRole("list", { name: "Exercises" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
  });

  it(`disables Add exercise at ${ROUTINE_ITEMS_MAX}`, async () => {
    const full = makeRoutine({
      id: routineId(2),
      name: "Big",
      items: Array.from({ length: ROUTINE_ITEMS_MAX }, (_, position) => makeRoutineItem({ position, exerciseId: exerciseId(1) })),
    });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [full] }) });
    renderApp(`/app/workouts/routines/${routineId(2)}/edit`);
    expect(await screen.findByRole("button", { name: "Add exercise" })).toBeDisabled();
    expect(screen.getByText("A routine can have up to 30 exercises")).toBeInTheDocument();
  });
});

describe("10.0 AC27 — item rows", () => {
  it("row text, Options disclosure, edge-disabled moves, focus follows the move and the remove", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    const { user } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    const list = await screen.findByRole("list", { name: "Exercises" });
    const main = within(list).getByRole("button", { name: "Overhead Press, 3 × 8" });
    expect(main).toHaveTextContent("Overhead Press");
    expect(main).toHaveTextContent("3 × 8");

    const rows = within(list).getAllByRole("listitem");
    const options = within(rows[2]!).getByRole("button", { name: "Options" });
    expect(options).toHaveAttribute("aria-expanded", "false");
    await user.click(options);
    expect(options).toHaveAttribute("aria-expanded", "true");
    expect(within(rows[2]!).getByRole("button", { name: "Move down" })).toBeDisabled();
    await user.click(within(rows[2]!).getByRole("button", { name: "Move up" }));
    // An ungrouped item jumps the whole superset above it.
    const names = within(list).getAllByRole("listitem").map((li) => li.getAttribute("data-name"));
    expect(names).toEqual(["Overhead Press", "Bench Press", "Barbell Row"]);
    expect(within(list).getByRole("button", { name: "Overhead Press, 3 × 8" })).toHaveFocus();

    const first = within(list).getAllByRole("listitem")[0]!;
    await user.click(within(first).getByRole("button", { name: "Remove" }));
    expect(within(list).getByRole("button", { name: /^Bench Press, superset 1/ })).toHaveFocus();
  });
});

describe("10.0 AC29 — the superset link control", () => {
  it("toggles between neighbours with aria-pressed and a name naming both", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    const { user } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    const list = await screen.findByRole("list", { name: "Exercises" });
    const linked = within(list).getByRole("button", { name: "Superset Bench Press with Barbell Row" });
    expect(linked).toHaveAttribute("aria-pressed", "true");
    const unlinked = within(list).getByRole("button", { name: "Superset Barbell Row with Overhead Press" });
    expect(unlinked).toHaveAttribute("aria-pressed", "false");
    expect(within(list).queryByRole("button", { name: /^Superset Overhead Press with/ })).toBeNull();
    await user.click(unlinked);
    expect(unlinked).toHaveAttribute("aria-pressed", "true");
    expect(within(list).getByRole("button", { name: "Overhead Press, superset 1, 3 × 8" })).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")[2]!.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("is disabled at the cap with the reason referenced by aria-describedby", async () => {
    const nine = makeRoutine({
      id: routineId(3),
      name: "Circuit",
      items: Array.from({ length: 9 }, (_, position) =>
        makeRoutineItem({ position, exerciseId: exerciseId(1), supersetGroup: position < 8 ? 1 : null }),
      ),
    });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [nine] }) });
    renderApp(`/app/workouts/routines/${routineId(3)}/edit`);
    const list = await screen.findByRole("list", { name: "Exercises" });
    const toggles = within(list).getAllByRole("button", { name: /^Superset / });
    const last = toggles[7]!;
    expect(last).toBeDisabled();
    const reason = document.getElementById(last.getAttribute("aria-describedby")!);
    expect(reason).toHaveTextContent("A superset can have up to 8 exercises");
  });
});

describe("10.0 AC30 — retired and removed rows in the editor", () => {
  it("after the catalog syncs, retired or deleted exercises show as Removed exercise with the marker", async () => {
    const odd = makeRoutine({
      id: routineId(5),
      name: "Odd",
      items: [makeRoutineItem({ position: 0, exerciseId: exerciseId(4) }), makeRoutineItem({ position: 1, exerciseId: exerciseId(99) })],
    });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [odd] }) });
    renderApp(`/app/workouts/routines/${routineId(5)}/edit`);
    const list = await screen.findByRole("list", { name: "Exercises" });
    await waitFor(() => expect(within(list).getAllByText("No longer available — remove or replace")).toHaveLength(2));
    expect(within(list).getAllByRole("button", { name: "Removed exercise, no longer available" })).toHaveLength(2);
  });
});

describe("10.0 AC5 — the adjusted-groups notice", () => {
  it("shows for a non-contiguous routine and dismisses", async () => {
    const odd = makeRoutine({
      id: routineId(6),
      name: "Gapped",
      items: [0, 1, 2, 3].map((position) => makeRoutineItem({ position, exerciseId: exerciseId(1), supersetGroup: position === 1 ? null : 1 })),
    });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [odd] }) });
    const { user } = renderApp(`/app/workouts/routines/${routineId(6)}/edit`);
    const notice = await screen.findByText("Supersets were adjusted so grouped exercises sit together");
    await user.click(within(notice.closest("[role=status]")!).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Supersets were adjusted so grouped exercises sit together")).toBeNull();
  });
});
