import { act, screen, waitFor, within } from "@testing-library/react";
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

import { resetDesktop, setDesktop } from "../test/desktop";
import { makeSet, makeWorkoutDetail, makeWorkoutSummary } from "../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../test/workoutHarness";

afterEach(() => {
  resetDesktop();
  cleanupApp();
});

/** A finished workout on day `n` of October (higher is newer), with its own title. */
const finished = (n: number, title: string) =>
  makeWorkoutDetail({
    id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title,
    startedAt: `2026-10-${String(n).padStart(2, "0")}T18:00:00.000Z`,
    endedAt: `2026-10-${String(n).padStart(2, "0")}T19:00:00.000Z`,
    localDate: `2026-10-${String(n).padStart(2, "0")}`,
    exercises: [{ modality: "weight_reps", name: "Bench press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 5 })] }],
  });

const OLDER = finished(2, "Older pull");
const NEWER = finished(5, "Newer push");

const panes = () => [...document.querySelectorAll<HTMLElement>("[data-pane]")];
/** The app draws the shell once `/v1/me` answers; wide tests wait for both panes before looking inside them. */
const panesReady = () => waitFor(() => expect(panes()).toHaveLength(2));

async function setup(path: string, workouts = [OLDER, NEWER], wide = true) {
  if (wide) setDesktop(true);
  const fake = createWorkoutFake({ finished: workouts, active: null });
  prepareApp({ auth, fake });
  const app = renderApp(path);
  if (wide) await panesReady();
  return { fake, ...app };
}
const listPane = () => panes()[0]!;
const detailPane = () => panes()[1]!;
const rowOf = (title: string) => within(listPane()).getByRole("link", { name: new RegExp(title) });
const reads = (fake: ReturnType<typeof createWorkoutFake>, id: string, from = 0) =>
  fake.requests.slice(from).filter((r) => r.method === "GET" && r.path === `/v1/workouts/${id}`);

describe("17.12 AC14 — History's URLs don't change, and the phone is today's", () => {
  it("narrow: the list, the summary and the edit screen render as on main (one h1, no panes)", async () => {
    const { router } = await setup("/app/history", undefined, false);
    expect(await screen.findByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
    expect(panes()).toEqual([]);
    expect(screen.queryByRole("heading", { level: 2, name: "History" })).toBeNull();

    await act(() => router.navigate(`/app/history/${NEWER.id}`));
    expect(await screen.findByRole("heading", { level: 1, name: "Workout summary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to History" })).toBeInTheDocument();
    expect(panes()).toEqual([]);
  });

  it("wide: /app/history/:id shows the list beside the workout", async () => {
    await setup(`/app/history/${OLDER.id}`);
    expect(await within(detailPane()).findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "History" })).toHaveLength(1);
    expect(await within(listPane()).findByText(/Newer push/)).toBeInTheDocument();
  });

  it("review focus 4: on the edit route, a title typed in the details sheet survives a resize both ways", async () => {
    const { user } = await setup(`/app/history/${NEWER.id}/edit`);
    await user.click(await screen.findByRole("button", { name: "Edit details" }));
    const field = await screen.findByRole("textbox", { name: "Title" });
    await user.clear(field);
    await user.type(field, "Leg day");
    act(() => setDesktop(false));
    expect(screen.getByRole("textbox", { name: "Title" })).toBe(field);
    expect(field).toHaveValue("Leg day");
    act(() => setDesktop(true));
    expect(screen.getByRole("textbox", { name: "Title" })).toBe(field);
    expect(field).toHaveValue("Leg day");
  });
});

describe("17.12 AC15 — the newest workout shows without a redirect", () => {
  it("wide /app/history: the newest workout opens in the detail, its row is selected, and the URL stays", async () => {
    const { router, fake } = await setup("/app/history");
    expect(await within(detailPane()).findByText("Newer push")).toBeInTheDocument();
    expect(rowOf("Newer push")).toHaveAttribute("aria-current", "page");
    expect(rowOf("Older pull")).not.toHaveAttribute("aria-current");
    expect(router.state.location.pathname).toBe("/app/history");
    expect(reads(fake, NEWER.id)).toHaveLength(1);
  });

  it("no workouts: the list says so, and the detail stays empty", async () => {
    await setup("/app/history", []);
    expect(await within(listPane()).findByText("No finished workouts yet")).toBeInTheDocument();
    expect(detailPane()).toBeEmptyDOMElement();
  });
});

describe("17.12 AC16 — choosing a row swaps the detail", () => {
  it("clicking another row opens it beside the list and moves the selection", async () => {
    const { user, router } = await setup("/app/history");
    await within(detailPane()).findByText("Newer push");
    await user.click(rowOf("Older pull"));
    expect(await within(detailPane()).findByText("Older pull")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/app/history/${OLDER.id}`);
    expect(rowOf("Older pull")).toHaveAttribute("aria-current", "page");
    expect(rowOf("Newer push")).not.toHaveAttribute("aria-current");
  });
});

describe("17.12 AC16 — each workout opens fresh", () => {
  // Code review #1: on a phone you always went back through the list; beside it, a click must not carry one
  // workout's screen state (an open menu, a failure notice) over to the next.
  it("an open Workout menu on one workout is closed on the next (already read, so no spinner remounts it)", async () => {
    const { user } = await setup(`/app/history/${OLDER.id}`);
    await within(detailPane()).findByText("Older pull");
    await user.click(rowOf("Newer push"));
    await within(detailPane()).findByText("Newer push");
    await user.click(within(detailPane()).getByRole("button", { name: "Workout menu" }));
    expect(within(detailPane()).getByRole("button", { name: "Delete workout" })).toBeInTheDocument();
    await user.click(rowOf("Older pull"));
    await within(detailPane()).findByText("Older pull");
    expect(within(detailPane()).getByRole("button", { name: "Workout menu" })).toHaveAttribute("aria-expanded", "false");
    expect(within(detailPane()).queryByRole("button", { name: "Delete workout" })).toBeNull();
  });
});

describe("17.12 AC17 — one h1, the list's title an h2, no back link, the Workout menu kept", () => {
  it("wide summary: the page's only h1 is the detail's; History is an h2; Edit sits above Delete in the menu", async () => {
    const { user } = await setup(`/app/history/${NEWER.id}`);
    await within(detailPane()).findByRole("heading", { name: "Workout summary" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(listPane()).getByRole("heading", { level: 2, name: "History" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to History" })).toBeNull();
    await user.click(within(detailPane()).getByRole("button", { name: "Workout menu" }));
    const edit = within(detailPane()).getByRole("button", { name: "Edit workout" });
    const del = within(detailPane()).getByRole("button", { name: "Delete workout" });
    expect(edit.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("17.12 AC18 — edit and delete work in the pane", () => {
  it("wide edit: the edit screen and its Done bar render inside the detail region", async () => {
    await setup(`/app/history/${NEWER.id}/edit`);
    const bar = await screen.findByTestId("edit-bar");
    expect(detailPane()).toContainElement(bar);
  });

  it("deleting from the summary lands on /app/history showing the next newest, and never reads the deleted one", async () => {
    const { user, router, fake } = await setup(`/app/history/${NEWER.id}`);
    await within(detailPane()).findByText("Newer push");
    await user.click(within(detailPane()).getByRole("button", { name: "Workout menu" }));
    await user.click(within(detailPane()).getByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
    const deleted = fake.requests.findIndex((r) => r.method === "DELETE");
    expect(await within(detailPane()).findByText("Older pull")).toBeInTheDocument();
    expect(rowOf("Older pull")).toHaveAttribute("aria-current", "page");
    expect(within(listPane()).queryByText(/Newer push/)).toBeNull();
    expect(reads(fake, NEWER.id, deleted + 1)).toEqual([]);
  });

  // Final review #1: the main desktop path — History opens the newest by itself and the lifter deletes it.
  it("from the bare /app/history: deleting the workout it opened shows the next newest, with no second history entry", async () => {
    const { user, router, fake } = await setup("/app/history");
    await within(detailPane()).findByText("Newer push");
    await user.click(within(detailPane()).getByRole("button", { name: "Workout menu" }));
    await user.click(within(detailPane()).getByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    expect(await within(detailPane()).findByText("Older pull")).toBeInTheDocument();
    await waitFor(() => expect(fake.state.finished.has(NEWER.id)).toBe(false));
    const deleted = fake.requests.findIndex((r) => r.method === "DELETE");
    expect(reads(fake, NEWER.id, deleted + 1)).toEqual([]);
    expect(router.state.location.pathname).toBe("/app/history");
    // Still the first entry: Back from here leaves History, it doesn't land on the same page again.
    expect(router.state.historyAction).not.toBe("PUSH");
  });

  it("the deleted workout is never opened next, even when the list's re-read fails", async () => {
    const { user, router, fake } = await setup(`/app/history/${NEWER.id}`);
    await within(detailPane()).findByText("Newer push");
    // The list re-read that follows the delete fails, so the cached pages are all the panes have.
    fake.failNext({ method: "GET", path: /^\/v1\/workouts$/ }, () => HttpResponse.error());
    await user.click(within(detailPane()).getByRole("button", { name: "Workout menu" }));
    await user.click(within(detailPane()).getByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
    const deleted = fake.requests.findIndex((r) => r.method === "DELETE");
    expect(await within(detailPane()).findByText("Older pull")).toBeInTheDocument();
    expect(reads(fake, NEWER.id, deleted + 1)).toEqual([]);
  });

  it("review focus 2: deleting the only workout leaves the empty list and an empty detail, and no read of it", async () => {
    const { user, router, fake } = await setup(`/app/history/${NEWER.id}`, [NEWER]);
    await within(detailPane()).findByText("Newer push");
    await user.click(within(detailPane()).getByRole("button", { name: "Workout menu" }));
    await user.click(within(detailPane()).getByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
    const deleted = fake.requests.findIndex((r) => r.method === "DELETE");
    expect(await within(listPane()).findByText("No finished workouts yet")).toBeInTheDocument();
    expect(detailPane()).toBeEmptyDOMElement();
    expect(reads(fake, NEWER.id, deleted + 1)).toEqual([]);
  });
});

describe("17.12 review focus — History's edge cases at desktop widths", () => {
  it("1: a workout that isn't in the loaded list opens in the detail, and no row is selected", async () => {
    setDesktop(true);
    const fake = createWorkoutFake({ finished: [OLDER, NEWER], active: null });
    prepareApp({ auth, fake });
    // The list's first page holds only the newer workout (the older one is on a page not loaded yet).
    fake.failNext({ method: "GET", path: /^\/v1\/workouts$/ }, () =>
      HttpResponse.json({ items: [makeWorkoutSummary({ id: NEWER.id, title: "Newer push", localDate: "2026-10-05" })], next: "fake.1" }),
    );
    renderApp(`/app/history/${OLDER.id}`);
    await panesReady();
    expect(await within(detailPane()).findByText("Older pull")).toBeInTheDocument();
    await within(listPane()).findByText(/Newer push/);
    expect(listPane().querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it("3: a list read that fails with nothing cached leaves the detail empty, with no read of a made-up id", async () => {
    setDesktop(true);
    const fake = createWorkoutFake({ finished: [OLDER, NEWER], active: null });
    prepareApp({ auth, fake });
    fake.failNext({ method: "GET", path: /^\/v1\/workouts$/ }, () => problemResponse(500, "about:blank"));
    renderApp("/app/history");
    await panesReady();
    expect(await within(listPane()).findByText(/Couldn't load your history/)).toBeInTheDocument();
    expect(within(listPane()).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(detailPane()).toBeEmptyDOMElement();
    expect(fake.requests.filter((r) => r.method === "GET" && /^\/v1\/workouts\/./.test(r.path) && r.path !== "/v1/workouts/active")).toEqual([]);
  });

  it("5: Load more keeps the selected row selected, and the detail doesn't change or refetch", async () => {
    const many = Array.from({ length: 22 }, (_, i) => finished(i + 1, `Workout ${i + 1}`));
    const { user, fake } = await setup("/app/history", many);
    expect(await within(detailPane()).findByText("Workout 22")).toBeInTheDocument();
    const before = reads(fake, many[21]!.id).length;
    await user.click(within(listPane()).getByRole("button", { name: "Load more" }));
    expect(await within(listPane()).findByText(/Workout 1\b/)).toBeInTheDocument();
    expect(rowOf("Workout 22")).toHaveAttribute("aria-current", "page");
    expect(within(detailPane()).getByText("Workout 22")).toBeInTheDocument();
    expect(reads(fake, many[21]!.id)).toHaveLength(before);
  });
});
