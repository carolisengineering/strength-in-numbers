import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { screen, waitFor, within } from "@testing-library/react";
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

import type { Exercise } from "@sin/core";
import { API_BASE_URL, USER_ID } from "../../test/catalogHarness";
import { makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { sheetRow } from "../../test/sheetHelpers";
import { stripCssComments } from "../../test/sourceScan";
import { makePersonalRecord, makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse, type WorkoutFakeOptions } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { EXERCISE_KEYS } from "./keys";
import { EXERCISES_COPY } from "./messages";
import { exercisePath } from "./paths";

afterEach(() => cleanupApp());

const BUILT_IN = "10000000-0000-4000-8000-0000000000f1";
const OWN = "10000000-0000-4000-8000-0000000000f2";
const COPY = "10000000-0000-4000-8000-0000000000f3";
const GONE = "10000000-0000-4000-8000-0000000000f4";
const DELETE = /^\/v1\/exercises\/[^/]+$/;

const bench = makeExercise({ id: BUILT_IN, name: "Bench Press", ownerUserId: null });
const own = makeExercise({ id: OWN, name: "Echo Bike", ownerUserId: USER_ID });
const copy = makeExercise({ id: COPY, name: "My bench", ownerUserId: USER_ID, forkedFromExerciseId: BUILT_IN });
const points = [makeProgressPoint({ localDate: "2026-09-01" }), makeProgressPoint({ localDate: "2026-10-06" })];
const logged = (...roots: string[]) => roots.map((rootId) => ({ rootId, lastLoggedOn: "2026-10-06" }));

// A built-in with an active fork redirects to the fork (18.2 AC19), so the copy is in the catalog only on its own page.
function setup(id: string, fake: WorkoutFakeOptions = {}, catalog: Exercise[] = id === COPY ? [bench, copy] : [bench, own]) {
  const f = createWorkoutFake({
    serveExercises: true,
    catalog,
    usage: logged(BUILT_IN, OWN),
    progress: { [BUILT_IN]: points, [OWN]: points, [COPY]: points },
    records: [makePersonalRecord({ exerciseId: id, exerciseName: "Lift" })],
    ...fake,
  });
  prepareApp({ auth, fake: f, catalog });
  return { fake: f, ...renderApp(exercisePath(id)) };
}

// The page's own disclosure; the Edit sheet has a "More details" one of its own.
const disclosures = () =>
  [...document.querySelectorAll("details")].filter((d) => d.querySelector(":scope > summary")?.textContent === EXERCISES_COPY.detailsLabel);
const disclosure = () => {
  const all = disclosures();
  expect(all).toHaveLength(1);
  return all[0]!;
};
const summary = () => disclosure().querySelector("summary")!;
const openDetails = async (user: ReturnType<typeof setup>["user"]) => {
  await user.click(summary());
  await waitFor(() => expect(disclosure()).toHaveAttribute("open"));
};
/** After `setup` (whose handlers would otherwise win): usage answers "never logged" once `until` resolves. */
const holdUsage = (until: Promise<void>) =>
  server.use(
    http.get(`${API_BASE_URL}/v1/exercises/usage`, async () => {
      await until;
      return HttpResponse.json({ exercises: [] });
    }),
  );
const chart = () => screen.findByRole("img", { name: /3 months/ });
const status = () => screen.getByTestId("exercise-status");
const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("17.11 AC1 — the page leads with its chart", () => {
  it("back, title, status, Metric, Range, chart, sessions, records, then the disclosure", async () => {
    setup(BUILT_IN);
    await chart();
    const region = await screen.findByRole("region", { name: "Personal records" });
    const order = [
      screen.getByRole("link", { name: EXERCISES_COPY.backToExercises }),
      screen.getByRole("heading", { level: 1, name: "Bench Press" }),
      status(),
      screen.getByRole("group", { name: "Metric" }),
      screen.getByRole("group", { name: "Range" }),
      screen.getByRole("img", { name: /3 months/ }),
      screen.getByRole("list", { name: "Sessions" }),
      region,
      disclosure(),
    ];
    for (let i = 1; i < order.length; i += 1) expect(follows(order[i - 1]!, order[i]!)).toBe(true);
  });
});

describe("17.11 AC3 — one closed disclosure holds what rarely changes", () => {
  it.each([
    ["a built-in", BUILT_IN, "Bench Press", [EXERCISES_COPY.makeCopy]],
    ["an own exercise", OWN, "Echo Bike", ["Edit", EXERCISES_COPY.deleteExercise]],
    ["a copy", COPY, "My bench", ["Edit", EXERCISES_COPY.deleteExercise]],
  ])("%s: closed, summary Exercise details, details and actions inside", async (_kind, id, name, buttons) => {
    setup(id);
    await screen.findByRole("heading", { level: 1, name });
    await chart();
    const details = disclosure();
    expect(details).not.toHaveAttribute("open");
    expect(summary()).toHaveTextContent(EXERCISES_COPY.detailsLabel);
    expect(details).toContainElement(screen.getByLabelText(EXERCISES_COPY.detailsLabel));
    for (const label of buttons) expect(details).toContainElement(screen.getByRole("button", { name: label, hidden: true }));
    if (id === BUILT_IN) expect(details).toContainElement(screen.getByText(EXERCISES_COPY.builtInNote));
  });

  it("the summary is at least the tap-target height", async () => {
    setup(BUILT_IN);
    await chart();
    const cls = [...summary().classList].find((c) => c.includes("disclosureSummary"));
    expect(cls).toBeDefined();
    const css = stripCssComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ExerciseScreen.module.css"), "utf8"));
    const rule = /\.disclosureSummary\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/min-height:\s*var\(--tap-target-min\)/);
  });
});

describe("17.11 AC4 — open when there is nothing else", () => {
  it("never logged: the disclosure is open, after the never-logged line", async () => {
    setup(OWN, { usage: [] });
    const line = await screen.findByText(EXERCISES_COPY.neverLogged);
    await waitFor(() => expect(disclosure()).toHaveAttribute("open"));
    expect(follows(line, disclosure())).toBe(true);
  });

  it("deleted: no disclosure", async () => {
    setup(GONE, { progress: { [GONE]: points }, records: [makePersonalRecord({ exerciseId: GONE, exerciseName: "Old lift" })] });
    await screen.findByRole("heading", { level: 1, name: "Old lift" });
    await chart();
    expect(disclosures()).toEqual([]);
  });
});

describe("17.11 AC5 — messages stay outside the disclosure", () => {
  it("a failed delete's notice comes before the disclosure and outside it", async () => {
    const { fake, user } = setup(OWN);
    await chart();
    await openDetails(user);
    await user.click(screen.getByRole("button", { name: EXERCISES_COPY.deleteExercise }));
    const dialog = await screen.findByRole("dialog", { name: EXERCISES_COPY.deleteTitle("Echo Bike") });
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fake.failNext({ method: "DELETE", path: DELETE }, () => problemResponse(500, "internal"));
    await user.click(confirm);
    const notice = await screen.findByText(EXERCISES_COPY.couldntSave);
    expect(disclosure()).not.toContainElement(notice);
    expect(follows(notice, disclosure())).toBe(true);
  });

  it("a failed delete scrolls its notice into view (the lifter tapped Delete far below it)", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const { fake, user } = setup(OWN);
      await chart();
      await openDetails(user);
      await user.click(screen.getByRole("button", { name: EXERCISES_COPY.deleteExercise }));
      const dialog = await screen.findByRole("dialog", { name: EXERCISES_COPY.deleteTitle("Echo Bike") });
      const confirm = within(dialog).getByRole("button", { name: "Delete" });
      await waitFor(() => expect(confirm).toBeEnabled());
      fake.failNext({ method: "DELETE", path: DELETE }, () => problemResponse(500, "internal"));
      scrolled.length = 0;
      await user.click(confirm);
      const notice = await screen.findByText(EXERCISES_COPY.couldntSave);
      await waitFor(() => expect(scrolled.some((el) => el.contains(notice))).toBe(true));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("Saved. shows in the status line, outside the disclosure, after it is closed", async () => {
    const { user } = setup(OWN);
    await chart();
    await openDetails(user);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit exercise" });
    await user.type(within(sheet).getByLabelText("Name"), " 2");
    await user.click(sheetRow().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(status()).toHaveTextContent(EXERCISES_COPY.saved));
    await user.click(summary());
    await waitFor(() => expect(disclosure()).not.toHaveAttribute("open"));
    expect(disclosure()).not.toContainElement(status());
    expect(status()).toHaveTextContent(EXERCISES_COPY.saved);
  });
});

describe("17.11 AC6 — 18.2's flows go through the disclosure", () => {
  it("Make your own copy lands on the copy, title focused, with the notice and the disclosure closed", async () => {
    const { fake, router, user } = setup(BUILT_IN, {}, [bench]);
    // The fake serves series by id, and the copy's id is minted by the fork.
    server.use(
      http.get(`${API_BASE_URL}/v1/progress/exercises/:id`, ({ params }) =>
        HttpResponse.json({ exerciseId: params["id"], points }),
      ),
    );
    await chart();
    await openDetails(user);
    await user.click(screen.getByRole("button", { name: EXERCISES_COPY.makeCopy }));
    await waitFor(() => expect(fake.state.catalog.some((e) => e.forkedFromExerciseId === BUILT_IN)).toBe(true));
    const made = fake.state.catalog.find((e) => e.forkedFromExerciseId === BUILT_IN)!;
    await waitFor(() => expect(router.state.location.pathname).toBe(exercisePath(made.id)));
    await waitFor(() => expect(status()).toHaveTextContent(EXERCISES_COPY.copyReady));
    const title = screen.getByRole("heading", { level: 1 });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(disclosure()).not.toHaveAttribute("open");
    expect(disclosure()).not.toContainElement(status());
  });

  it("closing Edit returns focus to Edit (18.2 AC54)", async () => {
    const { user } = setup(OWN);
    await chart();
    await openDetails(user);
    const edit = screen.getByRole("button", { name: "Edit" });
    await user.click(edit);
    await screen.findByRole("dialog", { name: "Edit exercise" });
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(edit));
    expect(disclosure()).toHaveAttribute("open");
  });

  it("canceling Delete returns focus to Delete exercise (18.2 AC54)", async () => {
    const { user } = setup(OWN);
    await chart();
    await openDetails(user);
    const del = screen.getByRole("button", { name: EXERCISES_COPY.deleteExercise });
    await user.click(del);
    const dialog = await screen.findByRole("dialog", { name: EXERCISES_COPY.deleteTitle("Echo Bike") });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(del));
  });

  it("Edit opened with the disclosure open leaves it open after Save", async () => {
    const { user } = setup(OWN);
    await chart();
    await openDetails(user);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit exercise" });
    await user.type(within(sheet).getByLabelText("Name"), " 2");
    await user.click(sheetRow().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(status()).toHaveTextContent(EXERCISES_COPY.saved));
    expect(disclosure()).toHaveAttribute("open");
  });
});

describe("17.11 AC6 — the disclosure's open state (Review Focus 1–3)", () => {
  it("a usage refetch that finds a set doesn't close the disclosure under the Edit sheet", async () => {
    const { user, queryClient } = setup(OWN, { usage: [] });
    await screen.findByText(EXERCISES_COPY.neverLogged);
    await waitFor(() => expect(disclosure()).toHaveAttribute("open"));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit exercise" });
    server.use(http.get(`${API_BASE_URL}/v1/exercises/usage`, () => HttpResponse.json({ exercises: logged(OWN) })));
    await queryClient.invalidateQueries({ queryKey: EXERCISE_KEYS.usage });
    await chart();
    expect(sheet).toHaveAttribute("open");
    expect(disclosure()).toHaveAttribute("open");
  });

  it("minor 506 — nor under the Delete dialog: Cancel still returns focus to Delete exercise", async () => {
    const { user, queryClient } = setup(OWN, { usage: [] });
    await screen.findByText(EXERCISES_COPY.neverLogged);
    await waitFor(() => expect(disclosure()).toHaveAttribute("open"));
    const del = screen.getByRole("button", { name: EXERCISES_COPY.deleteExercise });
    await user.click(del);
    const dialog = await screen.findByRole("dialog", { name: EXERCISES_COPY.deleteTitle("Echo Bike") });
    server.use(http.get(`${API_BASE_URL}/v1/exercises/usage`, () => HttpResponse.json({ exercises: logged(OWN) })));
    await queryClient.invalidateQueries({ queryKey: EXERCISE_KEYS.usage });
    await chart();
    expect(disclosure()).toHaveAttribute("open");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(del));
  });

  it("a never-logged page stays open while usage refetches (the default is the cached answer)", async () => {
    const held = deferred<void>();
    const { queryClient } = setup(OWN, { usage: [] });
    await screen.findByText(EXERCISES_COPY.neverLogged);
    await waitFor(() => expect(disclosure()).toHaveAttribute("open"));
    holdUsage(held.promise);
    void queryClient.invalidateQueries({ queryKey: EXERCISE_KEYS.usage });
    await waitFor(() => expect(queryClient.isFetching({ queryKey: EXERCISE_KEYS.usage })).toBe(1));
    expect(disclosure()).toHaveAttribute("open");
    held.resolve();
    await waitFor(() => expect(queryClient.isFetching({ queryKey: EXERCISE_KEYS.usage })).toBe(0));
    expect(disclosure()).toHaveAttribute("open");
  });

  it("a range change and a status keep the lifter's open; a closed one stays closed", async () => {
    const { user } = setup(OWN);
    await chart();
    await openDetails(user);
    await user.click(within(screen.getByRole("group", { name: "Range" })).getByRole("button", { name: "1Y" }));
    await screen.findByRole("img", { name: /1 year/ });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit exercise" });
    await user.type(within(sheet).getByLabelText("Name"), " 2");
    await user.click(sheetRow().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(status()).toHaveTextContent(EXERCISES_COPY.saved));
    expect(disclosure()).toHaveAttribute("open");
    await user.click(summary());
    await waitFor(() => expect(disclosure()).not.toHaveAttribute("open"));
    await user.click(within(screen.getByRole("group", { name: "Range" })).getByRole("button", { name: "3M" }));
    await chart();
    expect(disclosure()).not.toHaveAttribute("open");
  });

  it("usage landing late: closed with the body drawn, then open when it says never logged", async () => {
    const usage = deferred<void>();
    setup(OWN);
    holdUsage(usage.promise);
    await chart();
    expect(disclosure()).not.toHaveAttribute("open");
    usage.resolve();
    await screen.findByText(EXERCISES_COPY.neverLogged);
    await waitFor(() => expect(disclosure()).toHaveAttribute("open"));
  });

  it("usage landing late after the lifter toggled: stays as they left it", async () => {
    const usage = deferred<void>();
    const { user } = setup(OWN);
    holdUsage(usage.promise);
    await chart();
    await openDetails(user);
    await user.click(summary());
    await waitFor(() => expect(disclosure()).not.toHaveAttribute("open"));
    usage.resolve();
    await screen.findByText(EXERCISES_COPY.neverLogged);
    expect(disclosure()).not.toHaveAttribute("open");
  });
});
