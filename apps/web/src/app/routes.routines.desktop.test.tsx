import { act, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { catalog, pushA } from "../test/routineFixtures";
import { makeRoutine, makeSet, makeWorkoutDetail, routineId } from "../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../test/workoutHarness";
import { GONE_NOTICE, RESUMED_NOTICE, ROUTINE_GONE_NOTICE } from "../features/workouts/WorkoutsScreen";
import { GONE_TITLE } from "../features/workouts/messages";
import { outboxKey } from "../features/workouts/outbox/outbox";
import { localStorageAdapter } from "../storage/storage";
import { USER_ID } from "../test/catalogHarness";
import { optionsButton } from "../test/sessionHelpers";

afterEach(() => {
  resetDesktop();
  cleanupApp();
});

const pullB = makeRoutine({ ...pushA, id: routineId(2), name: "Pull B", notes: null });
const A = routineId(1);
const previewPath = (id: string) => `/app/workouts/routines/${id}`;
const editPath = (id: string) => `/app/workouts/routines/${id}/edit`;

const FINISHED = makeWorkoutDetail({
  id: "10000000-0000-4000-8000-000000000005",
  title: "Old push",
  startedAt: "2026-10-05T18:00:00.000Z",
  endedAt: "2026-10-05T19:00:00.000Z",
  localDate: "2026-10-05",
  exercises: [{ modality: "weight_reps", name: "Bench press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 5 })] }],
});

const panes = () => [...document.querySelectorAll<HTMLElement>("[data-pane]")];
const panesReady = () => waitFor(() => expect(panes()).toHaveLength(2));
const listPane = () => panes()[0]!;
const detailPane = () => panes()[1]!;
const rowOf = (name: string) => within(listPane()).getByRole("link", { name: new RegExp(`^${name}`) });
const startPosts = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/workouts");
const gets = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "GET").map((r) => r.path);

async function setup(path: string, options: { wide?: boolean; active?: ReturnType<typeof makeWorkoutDetail> | null } = {}) {
  const wide = options.wide ?? true;
  if (wide) setDesktop(true);
  const fake = createWorkoutFake({ routines: [pushA, pullB], catalog, active: options.active ?? null, finished: [FINISHED] });
  prepareApp({ auth, fake, catalog });
  const app = renderApp(path);
  return { fake, ...app };
}

/** The editor's Name field, once the routine has loaded into it. */
async function nameField(value = "Push A") {
  const field = await within(detailPane()).findByLabelText("Name");
  await waitFor(() => expect(field).toHaveValue(value));
  return field;
}

describe("17.12 AC25 — Workouts at desktop widths: Start and the routines beside the open routine", () => {
  it("/app/workouts: two plain panes, 'Choose a routine' the one h1, Start and the list an h2", async () => {
    await setup("/app/workouts");
    await panesReady();
    for (const pane of panes()) {
      expect(pane).not.toHaveAttribute("role");
      expect(pane).not.toHaveAttribute("aria-label");
    }
    expect(within(detailPane()).getByRole("heading", { level: 1, name: "Choose a routine" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(listPane()).getByRole("heading", { level: 2, name: "Start a workout" })).toBeInTheDocument();
    expect(await within(listPane()).findByRole("link", { name: /^Push A/ })).toBeInTheDocument();
  });

  it("/routines/:id: the preview in the detail pane", async () => {
    await setup(previewPath(A));
    await panesReady();
    expect(await within(detailPane()).findByRole("heading", { level: 1, name: "Push A" })).toBeInTheDocument();
    expect(within(detailPane()).getByRole("button", { name: "Start this routine" })).toBeInTheDocument();
  });

  it("routines/new, routines/import and a finished workout stay single columns", async () => {
    const { router } = await setup("/app/workouts/routines/new");
    expect(await screen.findByRole("heading", { level: 1, name: "New routine" })).toBeInTheDocument();
    expect(panes()).toEqual([]);
    await act(() => router.navigate("/app/workouts/routines/import"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts/routines/import"));
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(panes()).toEqual([]);
    await act(() => router.navigate(`/app/workouts/${FINISHED.id}`));
    expect(await screen.findByRole("heading", { level: 1, name: "Workout summary" })).toBeInTheDocument();
    expect(screen.getByText("Old push")).toBeInTheDocument();
    expect(panes()).toEqual([]);
  });
});

describe("17.12 AC26 — a live workout keeps its single column", () => {
  it.each([
    ["/app/workouts", "Workout"],
    [previewPath(A), "Push A"],
    [editPath(A), "Edit routine"],
  ])("%s with a live workout: no panes", async (path, heading) => {
    await setup(path, { active: makeWorkoutDetail() });
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(panes()).toEqual([]);
  });

  it("review focus 2: a resumed start from the list pane still says so, in the session's single column", async () => {
    const { fake, user } = await setup("/app/workouts");
    await panesReady();
    fake.state.active = makeWorkoutDetail(); // started on another device after this screen loaded
    await user.click(within(listPane()).getByRole("button", { name: "Start empty workout" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Workout" })).toBeInTheDocument();
    expect(await screen.findByText(RESUMED_NOTICE)).toBeInTheDocument();
    expect(panes()).toEqual([]);
  });

  it("starting from the list pane while a routine is open lands on /app/workouts with one workout", async () => {
    const { fake, router, user } = await setup(previewPath(A));
    await panesReady();
    await within(detailPane()).findByRole("heading", { level: 1, name: "Push A" });
    await user.click(within(listPane()).getByRole("button", { name: "Start empty workout" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Workout" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/workouts");
    expect(startPosts(fake)).toHaveLength(1);
    expect(startPosts(fake)[0]!.body).not.toHaveProperty("routineId");
    expect(panes()).toEqual([]);
  });

  it("review focus 4: the active read failing with nothing cached is today's error, one column, no routines read", async () => {
    setDesktop(true);
    const fake = createWorkoutFake({ routines: [pushA, pullB], catalog, active: null });
    prepareApp({ auth, fake, catalog });
    fake.failNext({ method: "GET", path: /\/v1\/workouts\/active$/ }, () => problemResponse(500, "about:blank"));
    renderApp("/app/workouts");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't load your workout/);
    expect(panes()).toEqual([]);
    expect(gets(fake).filter((p) => p.startsWith("/v1/routines"))).toEqual([]);
  });
});

describe("17.12 AC27 — the leave guard covers the pane", () => {
  it("another row and a rail item ask; the open row doesn't; a resize keeps the draft", async () => {
    const { router, user } = await setup(editPath(A));
    await panesReady();
    const field = await nameField();
    await user.clear(field);
    await user.type(field, "Push Z");

    await user.click(rowOf("Pull B"));
    const dialog = await screen.findByRole("dialog", { name: "Discard changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe(editPath(A));
    expect(field).toHaveValue("Push Z");

    await user.click(rowOf("Push A"));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).toBeNull();
    expect(router.state.location.pathname).toBe(editPath(A));

    await user.click(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "History" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Discard changes?" })).getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe(editPath(A));

    act(() => setDesktop(false));
    expect(panes()).toEqual([]);
    expect(screen.getByLabelText("Name")).toBe(field);
    act(() => setDesktop(true));
    await panesReady();
    expect(screen.getByLabelText("Name")).toBe(field);
    expect(field).toHaveValue("Push Z");
  });

  it("review focus 1: Start with unsaved changes asks first; Keep editing sends nothing; Discard starts one workout", async () => {
    const { fake, router, user } = await setup(editPath(A));
    await panesReady();
    const field = await nameField();
    await user.type(field, " heavy");

    await user.click(within(listPane()).getByRole("button", { name: "Start empty workout" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Discard changes?" })).getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe(editPath(A));
    expect(field).toHaveValue("Push A heavy");
    expect(startPosts(fake)).toEqual([]);

    await user.click(within(listPane()).getByRole("button", { name: "Start empty workout" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Discard changes?" })).getByRole("button", { name: "Discard" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Workout" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/workouts");
    await waitFor(() => expect(startPosts(fake)).toHaveLength(1));
    expect(router.state.location.state).toBeNull();
  });

  it("choosing a second routine opens it fresh: back on the first, its editor starts from the saved routine", async () => {
    const { router, user } = await setup(editPath(A));
    await panesReady();
    const field = await nameField();
    await user.type(field, " heavy");
    await user.click(rowOf("Pull B"));
    await user.click(within(await screen.findByRole("dialog", { name: "Discard changes?" })).getByRole("button", { name: "Discard" }));
    expect(await within(detailPane()).findByRole("heading", { level: 1, name: "Pull B" })).toBeInTheDocument();
    await act(() => router.navigate(editPath(A)));
    expect(await nameField()).toHaveValue("Push A");
  });
});

describe("17.12 AC28 — the editor's bar and its sheet in the pane", () => {
  it("Cancel and Save sit in the detail pane's action bar; an item opens a sheet, not a pane", async () => {
    const { router, user } = await setup(editPath(A));
    await panesReady();
    await nameField();
    const bar = detailPane().querySelector<HTMLElement>("[data-action-bar]");
    expect(bar).not.toBeNull();
    expect(within(bar!).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(bar!).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(listPane().querySelector("[data-action-bar]")).toBeNull();

    await user.click(within(detailPane()).getByRole("button", { name: /^Bench Press/ }));
    // The item sheet is a native <dialog> (the top layer, over both panes), not a route in the detail pane.
    const sheet = await screen.findByRole("dialog");
    expect(sheet.tagName).toBe("DIALOG");
    expect(router.state.location.pathname).toBe(editPath(A));
    expect(panes()).toHaveLength(2);
  });
});

describe("17.12 AC29 — selection and headings in the routine panes", () => {
  it.each([previewPath(A), editPath(A)])("%s: no 'Back to Workouts' in the detail; the open row is marked", async (path) => {
    await setup(path);
    await panesReady();
    expect(await within(detailPane()).findByRole("heading", { level: 1 })).toBeInTheDocument();
    await within(listPane()).findByRole("link", { name: /^Push A/ });
    expect(screen.queryByRole("link", { name: "Back to Workouts" })).toBeNull();
    expect(rowOf("Push A")).toHaveAttribute("aria-current", "page");
    expect(rowOf("Pull B")).not.toHaveAttribute("aria-current");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("17.12 review focus — the routine panes' edge cases", () => {
  it("3: deleting the open routine from its preview lands on 'Choose a routine', its row gone", async () => {
    const { router, user } = await setup(previewPath(A));
    await panesReady();
    await within(detailPane()).findByRole("heading", { level: 1, name: "Push A" });
    await user.click(within(detailPane()).getByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete Push A?" })).getByRole("button", { name: "Delete" }));
    expect(await within(detailPane()).findByRole("heading", { level: 1, name: "Choose a routine" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/workouts");
    await waitFor(() => expect(within(listPane()).queryByRole("link", { name: /^Push A/ })).toBeNull());
    expect(rowOf("Pull B")).toBeInTheDocument();
  });

  it("3: a routine gone when started from its preview: the list pane says so, the detail says 'Choose a routine'", async () => {
    const { fake, router, user } = await setup(previewPath(A));
    await panesReady();
    await within(detailPane()).findByRole("heading", { level: 1, name: "Push A" });
    fake.state.routines.delete(A); // deleted on another device
    await user.click(within(detailPane()).getByRole("button", { name: "Start this routine" }));
    expect(await within(listPane()).findByText(ROUTINE_GONE_NOTICE)).toBeInTheDocument();
    expect(within(detailPane()).getByRole("heading", { level: 1, name: "Choose a routine" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/workouts");
  });

});

describe("17.12 AC27 — final review: choosing the open routine changes nothing, so Back still works", () => {
  it("M1: preview → Edit → the open row → Cancel goes back to the preview, and Back from there reaches the list", async () => {
    const { router, user } = await setup("/app/workouts");
    await panesReady();
    await user.click(await within(listPane()).findByRole("link", { name: /^Push A/ }));
    await user.click(await within(detailPane()).findByRole("link", { name: "Edit" }));
    await nameField();
    await user.click(rowOf("Push A"));
    await user.click(within(detailPane()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(previewPath(A)));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/app/workouts");
  });
});

describe("17.12 AC26 — final review: a start beside a routine starts once, and only from its own tap", () => {
  it("M4: a stale startEmpty entry (no tap on this screen) starts nothing", async () => {
    setDesktop(true);
    const fake = createWorkoutFake({ routines: [pushA, pullB], catalog, active: null });
    prepareApp({ auth, fake, catalog });
    renderApp("/app/workouts", { startEmpty: true });
    await panesReady();
    await within(listPane()).findByRole("link", { name: /^Push A/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(startPosts(fake)).toEqual([]);
    expect(within(detailPane()).getByRole("heading", { level: 1, name: "Choose a routine" })).toBeInTheDocument();
  });

  it("M3: the resumed notice isn't left in the history entry, so Back doesn't say it again", async () => {
    const { fake, router, user } = await setup("/app/workouts");
    await panesReady();
    fake.state.active = makeWorkoutDetail();
    await user.click(within(listPane()).getByRole("button", { name: "Start empty workout" }));
    expect(await screen.findByText(RESUMED_NOTICE)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.state).toBeNull());
    await act(() => router.navigate("/app/history"));
    await act(() => router.navigate(-1));
    expect(await screen.findByRole("heading", { level: 1, name: "Workout" })).toBeInTheDocument();
    expect(screen.queryByText(RESUMED_NOTICE)).toBeNull();
  });
});

describe("17.12 AC26 — code review: what a live workout leaves behind keeps its single column or its notice", () => {
  it("#1: a workout the server no longer has: the list pane says so once the panes come back", async () => {
    const live = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }] });
    const { fake, user } = await setup("/app/workouts", { active: live });
    await screen.findByRole("heading", { level: 1, name: "Workout" });
    fake.failNext({ method: "DELETE", path: /\/workout-exercises\// }, () => problemResponse(409, "workout-finished"));
    fake.state.active = null;
    await user.click(optionsButton("X"));
    await user.click(within(screen.getByRole("article", { name: "X" })).getByRole("button", { name: "Remove exercise" }));
    await user.click(within(await screen.findByRole("dialog", { name: /^Remove X/ })).getByRole("button", { name: "Remove" }));
    await panesReady();
    expect(await within(listPane()).findByText(GONE_NOTICE)).toBeInTheDocument();
  });

  it("#2: a refused finish whose workout is gone keeps the whole column for its card, not the list pane", async () => {
    setDesktop(true);
    const w = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 })] }] });
    const fake = createWorkoutFake({ routines: [pushA, pullB], catalog, active: null });
    prepareApp({ auth, fake, catalog });
    const op = {
      id: "finish-op",
      kind: "finish",
      workoutId: w.id,
      userId: USER_ID,
      status: "failed",
      attempted: true,
      attempts: 1,
      nextAttemptAt: 0,
      enqueuedAt: 0,
      failure: { status: 404, type: "about:blank", requestId: "r-1" },
      body: { endedAt: "2026-10-02T11:00:00.000Z" },
      meta: { startedAt: w.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
    };
    localStorageAdapter().set(outboxKey(USER_ID), JSON.stringify({ v: 1, userId: USER_ID, idMap: {}, ops: [op] }));
    renderApp("/app/workouts");
    expect(await screen.findByRole("heading", { name: GONE_TITLE })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(panes()).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Choose a routine" })).toBeNull();
  });
});

describe("17.12 AC29 — code review: the open row still opens in a new tab", () => {
  it("#9: a plain click on the open row does nothing; a cmd-click is left to the browser, at the routine's own path", async () => {
    const { router } = await setup(editPath(A));
    await panesReady();
    await nameField();
    const open = rowOf("Push A");
    expect(open).toHaveAttribute("href", previewPath(A));
    const cmdClick = createEvent.click(open, { metaKey: true });
    fireEvent(open, cmdClick);
    expect(cmdClick.defaultPrevented).toBe(false);
    const plain = createEvent.click(open, { button: 0 });
    fireEvent(open, plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(router.state.location.pathname).toBe(editPath(A));
  });
});

describe("17.12 AC25 — owner call (2026-11-18): the saved line and notices lead the list pane, as on the phone", () => {
  it("a notice comes before Start empty workout in the list pane", async () => {
    setDesktop(true);
    const fake = createWorkoutFake({ routines: [pushA, pullB], catalog, active: null });
    prepareApp({ auth, fake, catalog });
    renderApp("/app/workouts", { notice: "routine-gone" });
    await panesReady();
    const notice = await within(listPane()).findByText(ROUTINE_GONE_NOTICE);
    const start = within(listPane()).getByRole("button", { name: "Start empty workout" });
    expect(notice.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const routines = within(listPane()).getByRole("heading", { name: "Routines" });
    expect(start.compareDocumentPosition(routines) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("17.12 AC30 — regression guards: the phone sends today's requests", () => {
  it("review focus 6: the phone's requests on the three routes are today's, in today's order", async () => {
    const { fake, router } = await setup("/app/workouts", { wide: false });
    await screen.findByRole("link", { name: /^Push A/ });
    await waitFor(() => expect(gets(fake)).toEqual(PHONE_INDEX));
    const before = fake.requests.length;
    await act(() => router.navigate(previewPath(A)));
    await screen.findByRole("button", { name: "Start this routine" });
    await waitFor(() => expect(gets({ requests: fake.requests.slice(before) } as never)).toEqual(PHONE_PREVIEW));
    const beforeEdit = fake.requests.length;
    await act(() => router.navigate(editPath(A)));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Push A"));
    await waitFor(() => expect(gets({ requests: fake.requests.slice(beforeEdit) } as never)).toEqual(PHONE_EDIT));
  });
});

/** Today's GETs (read from main before Phase D, e6e04984), in order: the editor reads nothing (the list is cached). */
const PHONE_INDEX = ["/v1/workouts/active", "/v1/routines"];
const PHONE_PREVIEW = ["/v1/workouts/active"];
const PHONE_EDIT: string[] = [];
