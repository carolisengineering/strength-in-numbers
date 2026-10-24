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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { exerciseId } from "../../test/catalogFixtures";
import { markupOf } from "../../test/markup";
import { catalog, pushA } from "../../test/routineFixtures";
import { makeRoutine, makeRoutineItem, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { KEEP_AS_ROUTINE, KEEP_FAILED, KEPT_STATUS, OFFLINE_KEEP, ONE_OFF_TAG, RATE_LIMITED, ROUTINE_GONE, oneOffNoteText } from "./messages";
import { oneOffDay } from "./oneOff";

afterEach(() => {
  observability.reportError.mockReset();
  cleanupApp();
});

describe("10.5 AC6 — an ordinary preview is unchanged", () => {
  it("renders exactly as before", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    renderApp(`/app/workouts/routines/${pushA.id}`);
    await screen.findByRole("heading", { level: 1, name: "Push A" });
    expect(markupOf(screen.getByRole("region", { name: "Push A" }))).toMatchSnapshot();
  });
});

const FUTURE = "2026-10-30T12:00:00.000Z";
const cls = makeRoutine({
  id: routineId(5),
  name: "Class Fri 16 Oct",
  oneOffUntil: FUTURE,
  createdAt: "2026-10-16T08:00:00.000Z",
  items: [makeRoutineItem({ position: 0, exerciseId: exerciseId(1) }), makeRoutineItem({ position: 1, exerciseId: exerciseId(3) })],
});
const KEEP_PATH = /\/keep$/;

function boot(routines = [cls, pushA]) {
  const fake = createWorkoutFake({ catalog, routines });
  prepareApp({ auth, catalog, fake });
  return fake;
}

/** Hold the next Keep; `release()` applies it on the fake (as the server would) and answers 204. */
function holdKeep(fake: ReturnType<typeof createWorkoutFake>) {
  const gate = deferred<Response>();
  fake.failNext({ method: "POST", path: KEEP_PATH }, () => gate.promise as unknown as Response);
  return {
    release() {
      const routine = fake.state.routines.get(cls.id)!;
      fake.state.routines.set(cls.id, { ...routine, oneOffUntil: null });
      gate.resolve(new HttpResponse(null, { status: 204 }));
    },
  };
}

const keeps = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.path === `/v1/routines/${cls.id}/keep`);

describe("10.5 AC6 — tag and note", () => {
  it("the tag in the screen region; the note with its date before Start", async () => {
    boot();
    renderApp(`/app/workouts/routines/${cls.id}`);
    const region = await screen.findByRole("region", { name: "Class Fri 16 Oct" });
    expect(within(region).getByText(ONE_OFF_TAG)).toBeInTheDocument();
    const note = within(region).getByText(oneOffNoteText(oneOffDay(FUTURE)));
    expect(note.compareDocumentPosition(screen.getByRole("button", { name: "Start this routine" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a past expiry shows the reduced note", async () => {
    boot([{ ...cls, oneOffUntil: "2026-01-01T00:00:00.000Z" }]);
    renderApp(`/app/workouts/routines/${cls.id}`);
    expect(await screen.findByText(oneOffNoteText(null))).toBeInTheDocument();
  });
});

describe("10.5 AC7 — Keep as a routine", () => {
  it("is shown only on a one-off", async () => {
    boot();
    renderApp(`/app/workouts/routines/${pushA.id}`);
    await screen.findByRole("heading", { level: 1, name: "Push A" });
    expect(screen.queryByRole("button", { name: KEEP_AS_ROUTINE })).toBeNull();
    expect(screen.queryByText(ONE_OFF_TAG)).toBeNull();
  });

  it("one body-less POST; busy; a double tap sends one; success clears the tag, note and button, confirms, focuses Edit", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    const button = await screen.findByRole("button", { name: KEEP_AS_ROUTINE });
    // Deferred minor 47: an empty polite live region (no status role) holds only the confirmation, not the note.
    const region = document.querySelector('[aria-live="polite"]')!;
    expect(region).toBeEmptyDOMElement();
    expect(region.contains(screen.getByText(oneOffNoteText(oneOffDay(FUTURE))))).toBe(false);
    const hold = holdKeep(fake);
    await user.dblClick(button);
    expect(screen.getByRole("button", { name: KEEP_AS_ROUTINE })).toHaveAttribute("aria-busy", "true");
    hold.release();
    await waitFor(() => expect(screen.queryByText(ONE_OFF_TAG)).toBeNull());
    expect(screen.queryByRole("button", { name: KEEP_AS_ROUTINE })).toBeNull();
    expect(screen.queryByText(oneOffNoteText(oneOffDay(FUTURE)))).toBeNull();
    // The same region, never remounted, fills with the confirmation, so it is announced.
    await waitFor(() => expect(region).toHaveTextContent(KEPT_STATUS));
    expect(region.isConnected).toBe(true);
    await waitFor(() => expect(screen.getByRole("link", { name: "Edit" })).toHaveFocus());
    expect(keeps(fake)).toHaveLength(1);
    expect(keeps(fake)[0]!.body).toBeUndefined();
  });

  it("a late response after leaving still patches the caches", async () => {
    const fake = boot();
    const error = vi.spyOn(console, "error");
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    const hold = holdKeep(fake);
    await user.click(await screen.findByRole("button", { name: KEEP_AS_ROUTINE }));
    await user.click(screen.getByRole("link", { name: "Back to Workouts" }));
    await screen.findByRole("list", { name: "Routines" });
    hold.release();
    await waitFor(() => expect(within(screen.getByRole("link", { name: /Class Fri 16 Oct/ })).queryByText(ONE_OFF_TAG)).toBeNull());
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("a failed revalidation after a Keep leaves it untagged", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    await user.click(await screen.findByRole("button", { name: KEEP_AS_ROUTINE }));
    fake.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => problemResponse(500, "about:blank"), 5);
    await screen.findByText(KEPT_STATUS);
    await user.click(screen.getByRole("link", { name: "Back to Workouts" }));
    const row = await screen.findByRole("link", { name: /Class Fri 16 Oct/ });
    expect(within(row).queryByText(ONE_OFF_TAG)).toBeNull();
  });
});

describe("10.5 AC8 — a 404 is not success", () => {
  it("the gone state; the list is invalidated", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    const button = await screen.findByRole("button", { name: KEEP_AS_ROUTINE });
    fake.state.routines.delete(cls.id);
    const listReads = () => fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/routines").length;
    const before = listReads();
    await user.click(button);
    expect(await screen.findByText(ROUTINE_GONE)).toBeInTheDocument();
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    expect(screen.queryByText(KEPT_STATUS)).toBeNull();
  });
});

describe("10.5 AC9 — Keep failures keep the one-off", () => {
  it.each([
    ["offline", () => HttpResponse.error(), OFFLINE_KEEP, false],
    ["429", () => problemResponse(429, "rate-limited"), RATE_LIMITED, false],
    ["500", () => problemResponse(500, "about:blank"), KEEP_FAILED, true],
  ] as const)("%s", async (_, response, text, retry) => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    fake.failNext({ method: "POST", path: KEEP_PATH }, response);
    await user.click(await screen.findByRole("button", { name: KEEP_AS_ROUTINE }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(within(alert).queryByRole("button", { name: "Retry" }) !== null).toBe(retry);
    if (retry) expect(alert).toHaveTextContent(/Request ID: \S+/);
    expect(screen.getByText(ONE_OFF_TAG)).toBeInTheDocument();
    expect(screen.getByText(oneOffNoteText(oneOffDay(FUTURE)))).toBeInTheDocument();
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("Retry after a 500 succeeds", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    fake.failNext({ method: "POST", path: KEEP_PATH }, () => problemResponse(500, "about:blank"));
    await user.click(await screen.findByRole("button", { name: KEEP_AS_ROUTINE }));
    await user.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(KEPT_STATUS)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(keeps(fake)).toHaveLength(2);
  });

  it("deferred minor 51: a 429 keeps its request id, like Delete's", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    fake.failNext({ method: "POST", path: KEEP_PATH }, () => problemResponse(429, "rate-limited"));
    await user.click(await screen.findByRole("button", { name: KEEP_AS_ROUTINE }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Request ID: \S+/);
  });

  it("deferred minor 53: Retry keeps focus while the retry is in flight; a second failure keeps it; success moves it to Edit", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    fake.failNext({ method: "POST", path: KEEP_PATH }, () => problemResponse(500, "about:blank"));
    await user.click(await screen.findByRole("button", { name: KEEP_AS_ROUTINE }));
    const retry = () => within(screen.getByRole("alert")).getByRole("button", { name: "Retry" });
    await screen.findByRole("alert");
    fake.failNext({ method: "POST", path: KEEP_PATH }, () => problemResponse(500, "about:blank"));
    await user.click(retry());
    expect(retry()).toHaveFocus();
    await waitFor(() => expect(keeps(fake)).toHaveLength(2));
    expect(retry()).toHaveFocus();
    const hold = holdKeep(fake);
    await user.click(retry());
    expect(retry()).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    hold.release();
    await screen.findByText(KEPT_STATUS);
    await waitFor(() => expect(screen.getByRole("link", { name: "Edit" })).toHaveFocus());
  });

  it("deferred minor 53 (review): a new Keep tap clears a notice that has no Retry while it is in flight", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    fake.failNext({ method: "POST", path: KEEP_PATH }, () => HttpResponse.error());
    await user.click(await screen.findByRole("button", { name: KEEP_AS_ROUTINE }));
    expect(await screen.findByRole("alert")).toHaveTextContent(OFFLINE_KEEP);
    const hold = holdKeep(fake);
    await user.click(screen.getByRole("button", { name: KEEP_AS_ROUTINE }));
    expect(screen.queryByRole("alert")).toBeNull();
    hold.release();
    await screen.findByText(KEPT_STATUS);
  });

  it("deferred minor 47: a one-off preview has no empty status element before a Keep", async () => {
    boot();
    renderApp(`/app/workouts/routines/${cls.id}`);
    await screen.findByRole("button", { name: KEEP_AS_ROUTINE });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an unrecognized failure is reported once, with static tags only", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    fake.failNext({ method: "POST", path: KEEP_PATH }, () => problemResponse(418, "teapot"));
    await user.click(await screen.findByRole("button", { name: KEEP_AS_ROUTINE }));
    await screen.findByRole("alert");
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "routines", op: "keep-routine" });
  });
});

describe("10.5 AC10 — Keep beside Delete and Edit", () => {
  it("Keep is disabled while a delete is in flight; deleting a one-off works as before", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    const gate = deferred<Response>();
    fake.failNext({ method: "DELETE", path: /^\/v1\/routines\// }, () => gate.promise as unknown as Response);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: KEEP_AS_ROUTINE })).toBeDisabled();
    fake.state.routines.delete(cls.id);
    gate.resolve(new HttpResponse(null, { status: 204 }));
    await screen.findByRole("list", { name: "Routines" });
    expect(screen.queryByRole("link", { name: /Class Fri 16 Oct/ })).toBeNull();
  });

  it("Delete is disabled while a Keep is in flight", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    const hold = holdKeep(fake);
    await user.click(await screen.findByRole("button", { name: KEEP_AS_ROUTINE }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    hold.release();
    await screen.findByText(KEPT_STATUS);
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("Edit and Save keep it a one-off; the PUT carries no oneOff", async () => {
    const fake = boot();
    const { user } = renderApp(`/app/workouts/routines/${cls.id}`);
    await user.click(await screen.findByRole("link", { name: "Edit" }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Class renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { level: 1, name: "Class renamed" });
    expect(screen.getByText(ONE_OFF_TAG)).toBeInTheDocument();
    const put = fake.requests.find((r) => r.method === "PUT")!;
    expect(Object.keys(put.body as object)).not.toContain("oneOff");
    expect(Object.keys(put.body as object)).not.toContain("oneOffUntil");
  });
});
