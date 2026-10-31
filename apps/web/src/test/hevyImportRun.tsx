import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { HevyImportBatch, HevyPair, HevyRoutine, HevyWorkout, Routine } from "@sin/core";

import { HEVY_IMPORT_PATH } from "../features/hevy/import/paths";
import { hevyKeyStore } from "../features/hevy/keyStore";
import { API_BASE_URL } from "./accountHarness";
import { exerciseId, makeExercise } from "./catalogFixtures";
import { USER_ID, userInfoOk, VALID_KEY } from "./hevyHarness";
import { fakeHevyApi, fakeImportApi, GENERATED_TEMPLATE_IDS, type FakeImportOptions } from "./hevyImportFakes";
import { server } from "./msw/server";
import { createWorkoutFake } from "./workoutFake";
import { prepareApp, renderApp } from "./workoutHarness";

/**
 * Test-only (Spec 20.1 Phase B): the whole import screen against a fake Hevy, the fake import API (its status too, so
 * `recordsStale` follows the run) and the workout fake (routines). Every generated template is paired to Bench Press.
 */

export const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });
export const GENERATED_TEMPLATES = GENERATED_TEMPLATE_IDS.map((id) => ({ id, title: `Template ${id}`, type: "weight_reps", is_custom: false }));
const pairOf = (id: string): HevyPair => ({
  hevyTemplateId: id,
  hevyTitle: `Template ${id}`,
  hevyType: "weight_reps",
  role: "exercise",
  exerciseId: BENCH.id,
  exerciseActive: true,
  measureRule: null,
  exportAs: false,
});

export interface ImportRunSetup {
  workouts: HevyWorkout[];
  routines?: HevyRoutine[];
  imports?: FakeImportOptions;
  /** Routines SIN already holds (the workout fake serves them). */
  existingRoutines?: Routine[];
  /** A fake import API that already exists (a second run on the same server, AC21). */
  sharedImports?: ReturnType<typeof fakeImportApi>;
}

export function setupImportRun(auth: Parameters<typeof prepareApp>[0]["auth"], opts: ImportRunSetup) {
  const fake = createWorkoutFake({ serveExercises: true, catalog: [BENCH], routines: opts.existingRoutines ?? [] });
  prepareApp({ auth, fake, catalog: [BENCH] });
  const hevy = fakeHevyApi({ templates: GENERATED_TEMPLATES, routines: opts.routines ?? [], workouts: opts.workouts });
  const imports = opts.sharedImports ?? fakeImportApi(opts.imports);
  const mapping = { pairs: GENERATED_TEMPLATE_IDS.map(pairOf), sectionRules: [] };
  server.use(...hevy.handlers, userInfoOk(), ...imports.handlers, http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json(mapping)));
  hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  return { hevy, imports, fake };
}

/** Renders the import, presses Start, and waits for the summary (routines ticked by name on the way, if any). */
export async function toSummary(opts: { tick?: string[] } = {}) {
  const view = renderApp(HEVY_IMPORT_PATH);
  await view.user.click(await screen.findByRole("button", { name: "Start" }));
  if (opts.tick !== undefined) {
    await screen.findByRole("heading", { level: 2, name: "Routines to copy" }, { timeout: 5000 });
    for (const name of opts.tick) await view.user.click(screen.getByRole("checkbox", { name: new RegExp(`^${name}`) }));
    await view.user.click(screen.getByRole("button", { name: "Continue" }));
  }
  await screen.findByRole("heading", { level: 2, name: "Summary" }, { timeout: 5000 });
  return view;
}

/** The Import button on the summary ("Import {n} workouts…"). */
export const importButton = () => screen.getByRole("button", { name: /^(Import|Link) \d/ });

export const realBatches = (imports: ReturnType<typeof fakeImportApi>) =>
  imports.log.filter((r) => r.path === "/v1/hevy/import/workouts" && (r.body as HevyImportBatch).dryRun === false).map((r) => r.body as HevyImportBatch);
export const finishRequests = (imports: ReturnType<typeof fakeImportApi>) => imports.log.filter((r) => r.path === "/v1/hevy/import/finish");

export { HEVY_IMPORT_PATH };
