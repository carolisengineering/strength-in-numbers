import { cleanup, screen, within } from "@testing-library/react";
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
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { hevyKeyStore } from "../keyStore";
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

  it("summary: the disabled Import says why in text", async () => {
    setup();
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 2, name: "Summary" }, { timeout: 5000 });
    checkStructure("Summary");
    const button = screen.getByRole("button", { name: /^Import / });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Importing comes in the next update/);
  });
});
