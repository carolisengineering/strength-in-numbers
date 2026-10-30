import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
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

import type { HevyPair, HevyRoutine } from "@sin/core";

import { API_BASE_URL } from "../../../test/accountHarness";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { setInstantPacing, userInfoOk, USER_ID, VALID_KEY } from "../../../test/hevyHarness";
import { fakeHevyApi, fakeImportApi, generateHevyWorkouts, GENERATED_TEMPLATE_IDS } from "../../../test/hevyImportFakes";
import { server } from "../../../test/msw/server";
import { createWorkoutFake } from "../../../test/workoutFake";
import { makeRoutine } from "../../../test/workoutFixtures";
import { importButton, setupImportRun, toSummary } from "../../../test/hevyImportRun";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { HEVY_KEYS } from "../keys";
import { hevyKeyStore } from "../keyStore";
import { MAPPING_UNAVAILABLE } from "./messages";
import { HEVY_IMPORT_PATH } from "./paths";

/** Spec 20.1 AC29 (D14: structural checks, no axe): landmarks, heading order, live regions and names per step. */

const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });
const templates = GENERATED_TEMPLATE_IDS.map((id) => ({ id, title: `Template ${id}`, type: "weight_reps", is_custom: false }));
const pairOf = (id: string): HevyPair => ({ hevyTemplateId: id, hevyTitle: `Template ${id}`, hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: false });
const routines: HevyRoutine[] = [
  { id: "r1", title: "Push A", folder_id: null, exercises: [{ index: 0, title: "x", exercise_template_id: GENERATED_TEMPLATE_IDS[0], sets: [] }] },
  { id: "r2", title: "legs", folder_id: null, exercises: [] },
];

function setup(opts: { pairs?: HevyPair[]; withRoutines?: boolean } = {}) {
  prepareApp({ auth, fake: createWorkoutFake({ serveExercises: true, catalog: [BENCH], routines: [makeRoutine({ name: "Legs" })] }), catalog: [BENCH] });
  const hevy = fakeHevyApi({ templates, routines: opts.withRoutines ? routines : [], workouts: generateHevyWorkouts(12) });
  const imports = fakeImportApi();
  server.use(
    ...hevy.handlers,
    userInfoOk(),
    ...imports.handlers.slice(0, 2),
    http.get(`${API_BASE_URL}/v1/hevy/status`, () => HttpResponse.json({ enabled: true, pairCount: 0, linkCount: 0, recordsStale: false })),
    http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json({ pairs: opts.pairs ?? GENERATED_TEMPLATE_IDS.map(pairOf), sectionRules: [] })),
  );
  hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  return { hevy };
}

beforeEach(() => setInstantPacing());
afterEach(() => {
  cleanup();
  hevyKeyStore.remove(USER_ID);
  cleanupApp();
});

/** One h1, then the step's h2 (and h3s inside it), in a region named by its heading; every control named. */
function checkStructure(stepTitle: string) {
  const headings = screen.getAllByRole("heading");
  const levels = headings.map((h) => Number(h.tagName.slice(1)));
  const h1 = headings.findIndex((h) => h.tagName === "H1" && h.textContent === "Import from Hevy");
  expect(h1).toBeGreaterThanOrEqual(0);
  const after = levels.slice(h1);
  for (let i = 1; i < after.length; i += 1) expect(after[i]! - after[i - 1]!).toBeLessThanOrEqual(1);
  expect(screen.getByRole("region", { name: stepTitle })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Import steps" })).toBeInTheDocument();
  for (const control of [...screen.queryAllByRole("button"), ...screen.queryAllByRole("checkbox"), ...screen.queryAllByRole("link")]) {
    expect(control).toHaveAccessibleName();
  }
}

describe("20.1 AC29 — structure per step", () => {
  it("preflight: landmarks, headings, names, and no live region has text at first paint", async () => {
    setup();
    renderApp(HEVY_IMPORT_PATH);
    await screen.findByRole("heading", { level: 2, name: "Before you start" });
    checkStructure("Before you start");
    for (const status of screen.queryAllByRole("status").filter((s) => s.closest("section[aria-labelledby='hevy-import-step']"))) {
      expect(status).toBeEmptyDOMElement();
    }
  });

  it("reading: the stage line is the step's polite status", async () => {
    const { hevy } = setup();
    hevy.holdPage("/v1/workouts", 1);
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 2, name: "Reading Hevy" });
    checkStructure("Reading Hevy");
    const region = screen.getByRole("region", { name: "Reading Hevy" });
    expect(within(region).getByRole("status")).toBeInTheDocument();
  });

  it("routines: every unavailable box says why in text, not color", async () => {
    setup({ withRoutines: true });
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 2, name: "Routines to copy" });
    checkStructure("Routines to copy");
    const legs = screen.getByRole("checkbox", { name: "legs" });
    expect(legs).toBeDisabled();
    expect(legs).toHaveAccessibleDescription("Already in your routines");
  });

  it("names: the cards sit under the step heading", async () => {
    setup({ pairs: [] });
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 2, name: "Pair exercises" });
    checkStructure("Pair exercises");
  });

  it("summary: Import is enabled; when a pre-write check fails it is disabled and says why in text (AC28)", async () => {
    setup();
    const { user, queryClient } = renderApp(HEVY_IMPORT_PATH);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 2, name: "Summary" }, { timeout: 5000 });
    checkStructure("Summary");
    expect(screen.getByRole("button", { name: /^Import / })).toBeEnabled();
    server.use(http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json({ type: "about:blank", title: "Boom", status: 500 }, { status: 500 })));
    await act(() => queryClient.refetchQueries({ queryKey: HEVY_KEYS.mapping }));
    const button = await screen.findByRole("button", { name: /^Import / });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAccessibleDescription(MAPPING_UNAVAILABLE);
  });
});

describe("20.1 AC29 — structure in the run", () => {
  const sixty = () => generateHevyWorkouts(60);
  const focusedHeading = (name: string) => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name }));

  it("running: focus on the step heading, the progress line is the step's polite status", async () => {
    const { imports } = setupImportRun(auth, { workouts: sixty() });
    const release = imports.gateRealBatch(1);
    const { user } = await toSummary();
    await user.click(importButton());
    await screen.findByRole("heading", { level: 2, name: "Importing" });
    checkStructure("Importing");
    focusedHeading("Importing");
    expect(within(screen.getByRole("region", { name: "Importing" })).getByRole("status")).toHaveTextContent(/^Importing… 0 of 60/);
    release();
    await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 });
  });

  it("paused: the reason is an alert in text, the back-online status is empty until it says something", async () => {
    const { imports } = setupImportRun(auth, { workouts: sixty() });
    const { user } = await toSummary();
    imports.failSequence([500, 500, 500, 500]);
    await user.click(importButton());
    await screen.findByRole("button", { name: "Resume" });
    checkStructure("Importing");
    const region = screen.getByRole("region", { name: "Importing" });
    expect(within(region).getByRole("alert")).toHaveTextContent("Paused: couldn't reach the server.");
    expect(within(region).getAllByRole("status")[1]).toBeEmptyDOMElement();
  });

  it("stopped: its own heading takes focus", async () => {
    const { imports } = setupImportRun(auth, { workouts: sixty() });
    const release = imports.gateRealBatch(1);
    const { user } = await toSummary();
    await user.click(importButton());
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    release();
    await screen.findByRole("heading", { level: 2, name: "Stopped" });
    checkStructure("Stopped");
    focusedHeading("Stopped");
  });

  it("done with a routine that failed: the problem is listed in text", async () => {
    const pushA: HevyRoutine = { id: "r1", title: "Push A", folder_id: null, exercises: [{ index: 0, title: "x", exercise_template_id: GENERATED_TEMPLATE_IDS[0], sets: [] }] };
    setupImportRun(auth, { workouts: generateHevyWorkouts(3), routines: [pushA] });
    server.use(http.post(`${API_BASE_URL}/v1/routines`, () => HttpResponse.json({ type: "about:blank", title: "Boom", status: 500 }, { status: 500 })));
    const { user } = await toSummary({ tick: ["Push A"] });
    await user.click(importButton());
    await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 });
    checkStructure("Done");
    focusedHeading("Done");
    expect(screen.getByRole("list", { name: "Routine notes" })).toHaveTextContent("Push A: Couldn't be created; run the import again to retry");
  });

  it("the leave dialog is named, and focus starts on Cancel", async () => {
    const { imports } = setupImportRun(auth, { workouts: sixty() });
    const release = imports.gateRealBatch(1);
    const { user } = await toSummary();
    await user.click(importButton());
    await screen.findByRole("heading", { level: 2, name: "Importing" });
    await user.click(screen.getByRole("link", { name: /Back to Hevy/ }));
    const dialog = await screen.findByRole("dialog", { name: "Stop the import?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    release();
    await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 });
  });
});
