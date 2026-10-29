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

import type { Exercise, HevyFolder, HevyPair, HevyRoutine, HevyWorkout, Routine } from "@sin/core";

import { API_BASE_URL, problem } from "../../../test/accountHarness";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { setInstantPacing, userInfoOk, USER_ID, VALID_KEY } from "../../../test/hevyHarness";
import { fakeHevyApi, fakeImportApi } from "../../../test/hevyImportFakes";
import { server } from "../../../test/msw/server";
import { createWorkoutFake } from "../../../test/workoutFake";
import { makeRoutine, routineId } from "../../../test/workoutFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { hevyKeyStore } from "../keyStore";
import { EXERCISE_LIMIT_MESSAGE } from "../../catalog/fieldErrors";
import { HEVY_IMPORT_PATH } from "./paths";

const MAPPING_URL = `${API_BASE_URL}/v1/hevy/mapping`;
const STATUS = { enabled: true, pairCount: 0, linkCount: 0, recordsStale: false };

const template = (id: string, title: string, type = "weight_reps") => ({ id, title, type, is_custom: false });
const hevyWorkout = (id: string, day: number, ...templates: [string, string][]): HevyWorkout => ({
  id,
  title: `Workout ${id}`,
  start_time: `2026-09-${String(day).padStart(2, "0")}T09:00:00Z`,
  end_time: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`,
  exercises: templates.map(([t, title], index) => ({ index, title, exercise_template_id: t, sets: [{ index: 0, type: "normal", weight_kg: 50, reps: 5 }] })),
});
const hevyRoutine = (id: string, title: string, folder_id: number | null, ...templates: string[]): HevyRoutine => ({
  id,
  title,
  folder_id,
  exercises: templates.map((t, index) => ({ index, title: t, exercise_template_id: t, sets: [] })),
});
const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });

/** The mapping in memory: GET serves it, PATCH upserts as the server does. */
function mappingFake(initial: HevyPair[] = []) {
  let pairs = [...initial];
  const patches: unknown[] = [];
  const handlers = [
    http.get(MAPPING_URL, () => HttpResponse.json({ pairs, sectionRules: [] })),
    http.patch(MAPPING_URL, async ({ request }) => {
      const body = (await request.json()) as { upsert?: (Omit<HevyPair, "exerciseActive">)[] };
      patches.push(body);
      for (const p of body.upsert ?? []) {
        pairs = pairs.filter((x) => x.hevyTemplateId !== p.hevyTemplateId);
        pairs.push({ ...p, exerciseActive: p.role === "exercise" ? true : null });
      }
      return HttpResponse.json({ pairs, sectionRules: [] });
    }),
  ];
  return { handlers, patches, pairs: () => pairs };
}

interface Setup {
  workouts: HevyWorkout[];
  templates: unknown[];
  routines?: HevyRoutine[];
  folders?: HevyFolder[];
  sinRoutines?: Routine[];
  catalog?: Exercise[];
  pairs?: HevyPair[];
}

function setup(opts: Setup) {
  const fake = createWorkoutFake({ routines: opts.sinRoutines ?? [], serveExercises: true, catalog: opts.catalog ?? [BENCH] });
  prepareApp({ auth, fake, catalog: opts.catalog ?? [BENCH] });
  const hevy = fakeHevyApi({ templates: opts.templates, folders: opts.folders ?? [], routines: opts.routines ?? [], workouts: opts.workouts });
  const imports = fakeImportApi({ recordsStale: false });
  const mapping = mappingFake(opts.pairs);
  server.use(...hevy.handlers, userInfoOk(), ...mapping.handlers, ...imports.handlers.slice(0, 2), http.get(`${API_BASE_URL}/v1/hevy/status`, () => HttpResponse.json(STATUS)));
  hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  return { fake, hevy, imports, mapping };
}

beforeEach(() => setInstantPacing());
afterEach(() => {
  cleanup();
  hevyKeyStore.remove(USER_ID);
  cleanupApp();
});

async function start() {
  const view = renderApp(HEVY_IMPORT_PATH);
  await view.user.click(await screen.findByRole("button", { name: "Start" }));
  return view;
}

describe("20.1 AC8 — markers step", () => {
  const templates = [template("WU", "Warmup", "reps_only"), template("B", "Bench Press"), template("R", "Seated Row")];
  const workouts = [hevyWorkout("w1", 1, ["WU", "Warmup"], ["B", "Bench Press"], ["R", "Seated Row"])];

  it("stops for the markers; saving them moves on", async () => {
    const { mapping } = setup({ workouts, templates });
    const { user } = await start();
    expect(await screen.findByText(/Your Hevy workouts use Warmup and workout exercises as section markers\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose markers" }));
    const dialog = await screen.findByRole("dialog", { name: "Section markers" });
    await within(dialog).findByRole("group", { name: "Warmup" });
    await user.click(within(dialog).getByRole("button", { name: "Save markers" }));
    await waitFor(() => expect(mapping.patches).toHaveLength(1));
    // The names step is next: Seated Row has no pair (Bench Press matches the catalog but is still a need).
    expect(await screen.findByRole("heading", { level: 2, name: "Pair exercises" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Warmup" })).toBeNull();
  });

  it("Skip goes on, and the marker template is then an ordinary name", async () => {
    setup({ workouts, templates });
    const { user } = await start();
    await user.click(await screen.findByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Pair exercises" })).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Warmup" })).toBeInTheDocument();
  });
});

describe("20.1 AC7 — routines step", () => {
  const templates = [template("B", "Bench Press")];
  const workouts = [hevyWorkout("w1", 1, ["B", "Bench Press"])];
  const folders = [{ id: 7, index: 1, title: "Later" }, { id: 3, index: 0, title: "Push Pull" }];
  const routines = [
    hevyRoutine("h1", "Push A", 3, "B"),
    hevyRoutine("h2", "Pull A", 3, "B"),
    hevyRoutine("h3", "Legs", 3, "B"),
    hevyRoutine("h4", "Arms", 7, "B"),
    hevyRoutine("h5", "Loose", null, "B"),
  ];
  const sin = (n: number) => Array.from({ length: n }, (_, i) => makeRoutine({ id: routineId(i + 1), name: i === 0 ? "legs" : `Routine ${i}` }));
  const pair: HevyPair = { hevyTemplateId: "B", hevyTitle: "Bench Press", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: true };

  it("lists folders in Hevy's order, marks names SIN already has, and counts the room", async () => {
    setup({ workouts, templates, folders, routines, sinRoutines: sin(8), pairs: [pair] });
    const { user } = await start();
    expect(await screen.findByText("You have 8 of 50 routines; room for 42 more.")).toBeInTheDocument();
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Push Pull", "Later", "No folder"]);
    const legs = screen.getByRole("checkbox", { name: "Legs" });
    expect(legs).toBeDisabled();
    expect(legs).toHaveAccessibleDescription("Already in your routines");
    expect(screen.getByRole("checkbox", { name: "Push A" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Push A" }));
    expect(screen.getByRole("status", { name: "" })).toBeDefined();
    expect(await screen.findByText("1 routine chosen")).toHaveAttribute("role", "status");
  });

  it("once the room is used, the rest are disabled with the reason; Tick all respects the room", async () => {
    setup({ workouts, templates, folders, routines, sinRoutines: sin(48), pairs: [pair] });
    const { user } = await start();
    await screen.findByText("You have 48 of 50 routines; room for 2 more.");
    await user.click(screen.getByRole("button", { name: "Tick all in this folder: Push Pull" }));
    expect(screen.getByRole("checkbox", { name: "Push A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Pull A" })).toBeChecked();
    const arms = screen.getByRole("checkbox", { name: "Arms" });
    expect(arms).toBeDisabled();
    expect(arms).toHaveAccessibleDescription("No room for more routines");
    expect(screen.getByText("2 routines chosen")).toBeInTheDocument();
  });

  it("Continue with none ticked is allowed", async () => {
    setup({ workouts, templates, folders, routines, sinRoutines: sin(1), pairs: [pair] });
    const { user } = await start();
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.queryByRole("heading", { level: 2, name: "Routines to copy" })).toBeNull());
  });

  it("with no Hevy routines the step is skipped", async () => {
    setup({ workouts, templates, pairs: [] });
    await start();
    expect(await screen.findByRole("heading", { level: 2, name: "Pair exercises" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Routines to copy" })).toBeNull();
  });
});

describe("20.1 AC9 — names step", () => {
  const templates = [template("B", "Bench Press"), template("R", "Seated Row"), template("C", "Cable Fly")];
  const workouts = [
    hevyWorkout("w1", 1, ["R", "Seated Row"], ["B", "Bench Press"]),
    hevyWorkout("w2", 2, ["R", "Seated Row"], ["C", "Cable Fly"]),
    hevyWorkout("w3", 3, ["R", "Seated Row"]),
  ];

  it("lists the cards by usage, says what would be created, and holds Continue while the creates don't fit", async () => {
    setup({ workouts, templates });
    await start();
    await screen.findByRole("heading", { level: 2, name: "Pair exercises" });
    const names = ["Seated Row", "Bench Press", "Cable Fly"].map((n) => screen.getByRole("group", { name: n }));
    expect(names[0]!.compareDocumentPosition(names[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(names[0]!).getByText(/3 workouts/)).toBeInTheDocument();
    expect(screen.getByText("This would create 2 exercises; you can add 500 more")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });

  it("Continue is off when the creates exceed the room", async () => {
    const own = Array.from({ length: 499 }, (_, i) => makeExercise({ id: exerciseId(100 + i), name: `Mine ${i}`, ownerUserId: USER_ID }));
    setup({ workouts, templates, catalog: [BENCH, ...own] });
    await start();
    expect(await screen.findByText("This would create 2 exercises; you can add 1 more")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  }, 30_000);
});

describe("20.1 AC32 — a deleted custom exercise", () => {
  it("is a card labeled No longer in Hevy; matching it saves its id, title and inferred type", async () => {
    const templates = [template("B", "Bench Press")];
    const workouts = [hevyWorkout("w1", 1, ["GONE", "Bench Press Old"], ["B", "Bench Press"])];
    const pair: HevyPair = { hevyTemplateId: "B", hevyTitle: "Bench Press", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: true };
    const { mapping, user } = await (async () => {
      const s = setup({ workouts, templates, pairs: [pair] });
      const view = await start();
      return { ...s, user: view.user };
    })();
    const card = await screen.findByRole("group", { name: "Bench Press Old" });
    expect(card).toHaveTextContent("No longer in Hevy");
    await user.click(within(card).getByRole("button", { name: /Choose another/ }));
    const picker = await screen.findByRole("dialog");
    await user.click(within(picker).getByRole("button", { name: /Bench Press/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mapping.patches).toHaveLength(1));
    expect(mapping.patches[0]).toEqual({
      upsert: [{ hevyTemplateId: "GONE", hevyTitle: "Bench Press Old", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, measureRule: null, exportAs: false }],
    });
  });
});

describe("20.1 AC10 — saving the names", () => {
  const templates = [template("B", "Bench Press"), template("R", "Seated Row")];
  const workouts = [hevyWorkout("w1", 1, ["R", "Seated Row"], ["B", "Bench Press"])];

  it("creates the new exercise, then saves the pairs, then leaves the names step", async () => {
    const { fake, mapping } = setup({ workouts, templates });
    const { user } = await start();
    await screen.findByRole("heading", { level: 2, name: "Pair exercises" });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mapping.patches).toHaveLength(1));
    const creates = fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/exercises");
    expect(creates).toHaveLength(1);
    const upsert = (mapping.patches[0] as { upsert: { hevyTemplateId: string; role: string }[] }).upsert;
    expect(upsert.map((p) => p.hevyTemplateId).sort()).toEqual(["B", "R"]);
    await waitFor(() => expect(screen.queryByRole("heading", { level: 2, name: "Pair exercises" })).toBeNull());
    // The summary counts what the names step created (AC12).
    expect(await screen.findByText("1 exercise was created while pairing.", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("shows the creating line while a create is in flight, and leaving stops further creates", async () => {
    const two = [template("R", "Seated Row"), template("C", "Cable Fly")];
    const { mapping } = setup({ workouts: [hevyWorkout("w1", 1, ["R", "Seated Row"], ["C", "Cable Fly"])], templates: two });
    let creates = 0;
    let release: () => void = () => {};
    server.use(
      http.post(`${API_BASE_URL}/v1/exercises`, async () => {
        creates += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ error: "held" }, { status: 503 });
      }),
    );
    const { user, router } = await start();
    await screen.findByRole("heading", { level: 2, name: "Pair exercises" });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Creating exercises… 0 of 2")).toHaveAttribute("role", "status");
    await act(() => router.navigate("/app/profile"));
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(creates).toBe(1);
    expect(mapping.patches).toHaveLength(0);
  });

  it("a second Continue after a failure reuses the exercise the first one created", async () => {
    const two = [template("R", "Seated Row"), template("C", "Cable Fly")];
    const { fake, mapping } = setup({ workouts: [hevyWorkout("w1", 1, ["R", "Seated Row"], ["C", "Cable Fly"])], templates: two });
    // The first create lands; the second fails once (after the 4 s gap savePairings keeps between creates).
    fake.failNext({ method: "POST", path: /^\/v1\/exercises$/ }, () => problem(500, "internal"), 1, 1);
    const { user } = await start();
    await screen.findByRole("heading", { level: 2, name: "Pair exercises" });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert", {}, { timeout: 10_000 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mapping.patches).toHaveLength(1), { timeout: 10_000 });
    const creates = fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/exercises");
    // Cards sort by usage, then title: Cable Fly lands, Seated Row fails once and is retried; Cable Fly is never made twice.
    expect(creates.map((r) => (r.body as { name: string }).name)).toEqual(["Cable Fly", "Seated Row", "Seated Row"]);
    const upsert = (mapping.patches[0] as { upsert: { hevyTemplateId: string; exerciseId: string }[] }).upsert;
    expect(new Set(upsert.map((p) => p.exerciseId)).size).toBe(2);
  }, 20_000);

  it("a full exercise cap shows the 20.0 sentence and returns to the cards as chosen", async () => {
    const { fake } = setup({ workouts, templates });
    fake.failNext({ method: "POST", path: /^\/v1\/exercises$/ }, () => problem(409, "exercise-limit-reached"));
    const { user } = await start();
    await screen.findByRole("heading", { level: 2, name: "Pair exercises" });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(EXERCISE_LIMIT_MESSAGE)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Seated Row" })).getByRole("radio", { name: "New exercise" })).toBeChecked();
  });
});
