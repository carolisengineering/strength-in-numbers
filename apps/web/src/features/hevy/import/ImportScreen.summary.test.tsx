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

import type { HevyImportBatch, HevyPair, HevyRoutine, HevyWorkout } from "@sin/core";

import { API_BASE_URL } from "../../../test/accountHarness";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { setInstantPacing, userInfoOk, USER_ID, VALID_KEY } from "../../../test/hevyHarness";
import { fakeHevyApi, fakeImportApi, generateHevyWorkouts, GENERATED_TEMPLATE_IDS, type FakeImportOptions } from "../../../test/hevyImportFakes";
import { server } from "../../../test/msw/server";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { HEVY_KEYS } from "../keys";
import { hevyKeyStore } from "../keyStore";
import { HEVY_PATH } from "../paths";
import { SUMMARY_STALE } from "./messages";
import { HEVY_IMPORT_PATH } from "./paths";

const MAPPING_URL = `${API_BASE_URL}/v1/hevy/mapping`;
const STATUS = { enabled: true, pairCount: 0, linkCount: 0, recordsStale: false };
const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });
const templates = GENERATED_TEMPLATE_IDS.map((id) => ({ id, title: `Template ${id}`, type: "weight_reps", is_custom: false }));
const pairOf = (id: string): HevyPair => ({ hevyTemplateId: id, hevyTitle: `Template ${id}`, hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: false });

function setup(opts: { workouts: HevyWorkout[]; routines?: HevyRoutine[]; imports?: FakeImportOptions; templates?: unknown[] }) {
  prepareApp({ auth, fake: createWorkoutFake({ serveExercises: true, catalog: [BENCH] }), catalog: [BENCH] });
  const hevy = fakeHevyApi({ templates: opts.templates ?? templates, routines: opts.routines ?? [], workouts: opts.workouts });
  const imports = fakeImportApi(opts.imports);
  let pairs = GENERATED_TEMPLATE_IDS.map(pairOf);
  server.use(
    ...hevy.handlers,
    userInfoOk(),
    ...imports.handlers.slice(0, 2),
    http.get(`${API_BASE_URL}/v1/hevy/status`, () => HttpResponse.json(STATUS)),
    http.get(MAPPING_URL, () => HttpResponse.json({ pairs, sectionRules: [] })),
  );
  hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  return {
    hevy,
    imports,
    removePair: (id: string) => {
      pairs = pairs.filter((p) => p.hevyTemplateId !== id);
    },
  };
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
const summaryHeading = () => screen.findByRole("heading", { level: 2, name: "Summary" }, { timeout: 5000 });
const bodies = (log: { path: string; body: unknown }[]) => log.filter((r) => r.path === "/v1/hevy/import/workouts").map((r) => r.body as HevyImportBatch);

describe("20.1 AC11 — checking", () => {
  it("shows progress, then the summary; every body is a dry run, newest first", async () => {
    const { imports } = setup({ workouts: generateHevyWorkouts(60) });
    imports.holdBatch(2);
    await start();
    expect(await screen.findByText("Checking your workouts… 25 of 60")).toHaveAttribute("role", "status");
    const sent = bodies(imports.log);
    expect(sent.every((b) => b.dryRun === true)).toBe(true);
    expect(sent[0]!.workouts[0]!.startTime).toBe("2026-10-28T17:00:00.000Z");
  });

  it("sends every batch newest first and reaches the summary", async () => {
    const { imports } = setup({ workouts: [...generateHevyWorkouts(60)].reverse() });
    await start();
    await summaryHeading();
    const sent = bodies(imports.log);
    expect(sent.map((b) => b.workouts.length)).toEqual([25, 25, 10]);
    const starts = sent.flatMap((b) => b.workouts.map((w) => Date.parse(w.startTime)));
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
  });

  it("a reply that doesn't add up says so and offers Back", async () => {
    const { imports } = setup({ workouts: generateHevyWorkouts(3) });
    imports.failNext("short");
    await start();
    expect(await screen.findByText("The server's reply wasn't understood.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("20.1 AC12 — summary", () => {
  const workouts = generateHevyWorkouts(130);
  const rejected = new Set(workouts.slice(0, 120).map((w) => w.id));
  const opts: FakeImportOptions = {
    outcomeFor: (id) => (rejected.has(id) ? "rejected" : id === workouts[120]!.id ? "duplicate" : undefined),
    links: [{ hevyWorkoutId: workouts[121]!.id, origin: "imported" }, { hevyWorkoutId: workouts[122]!.id, origin: "sent" }],
    dropsFor: (id) => (id === workouts[125]!.id ? [{ code: "set_out_of_range", count: 2 }, { code: "exercise_no_sets", count: 1 }] : []),
  };

  it("counts every outcome, the sets, and lists each group collapsed with its count", async () => {
    const { imports } = setup({ workouts, imports: opts });
    const { user } = await start();
    await summaryHeading();
    expect(screen.getByText("130 workouts read")).toBeInTheDocument();
    const counts = within(screen.getByRole("list", { name: "130 workouts read" }));
    expect(counts.getByText("7 will be imported")).toBeInTheDocument();
    expect(counts.getByText("1 already in SIN")).toBeInTheDocument();
    expect(counts.getByText("1 already matches a workout in SIN (it'll be linked, not copied)")).toBeInTheDocument();
    expect(counts.getByText("1 sent from SIN earlier")).toBeInTheDocument();
    expect(counts.getByText("120 can't be imported")).toBeInTheDocument();
    const sum = counts.getAllByRole("listitem").reduce((n, li) => n + Number(li.textContent!.split(" ")[0]!.replace(",", "")), 0);
    expect(sum).toBe(130);
    expect(screen.getByText(/Sets: [\d,]+ kept, 2 dropped/)).toBeInTheDocument();
    expect(screen.getByText("A set had a number out of range: 2")).toBeInTheDocument();
    expect(screen.getByText("Nothing has been written yet.")).toBeInTheDocument();
    const group = screen.getByText("Can't be imported (120)").closest("details")!;
    expect(group).not.toHaveAttribute("open");
    expect(screen.getByText("Sets dropped (2 sets in 1 workout)")).toBeInTheDocument();
    await user.click(screen.getByText("Can't be imported (120)"));
    expect(within(group).getAllByRole("listitem")).toHaveLength(50);
    await user.click(within(group).getByRole("button", { name: "Show 50 more" }));
    expect(within(group).getAllByRole("listitem")).toHaveLength(100);
    expect(bodies(imports.log).every((b) => b.dryRun)).toBe(true);
    expect(imports.links.size).toBe(2);
  });

  it("renders a title as text, never markup", async () => {
    const odd = [{ ...generateHevyWorkouts(1)[0]!, title: "<b>x</b>" }];
    setup({ workouts: odd, imports: { outcomeFor: () => "rejected" } });
    const { user } = await start();
    await summaryHeading();
    await user.click(screen.getByText("Can't be imported (1)"));
    expect(screen.getByText(/<b>x<\/b>/)).toBeInTheDocument();
    expect(document.querySelector("details b")).toBeNull();
  });
});

describe("20.1 AC6 / D9 — unreadable workouts", () => {
  it("are never sent and are listed as can't be imported", async () => {
    const [good, bad] = generateHevyWorkouts(2);
    const unreadable = { ...bad!, exercises: [{ ...bad!.exercises[0]!, sets: [{ ...bad!.exercises[0]!.sets[0]!, type: "superset" }] }] };
    const { imports } = setup({ workouts: [good!, unreadable] });
    const { user } = await start();
    await summaryHeading();
    expect(bodies(imports.log).flatMap((b) => b.workouts.map((w) => w.hevyWorkoutId))).toEqual([good!.id]);
    expect(screen.getByText("1 can't be imported")).toBeInTheDocument();
    await user.click(screen.getByText("Can't be imported (1)"));
    expect(screen.getByText(/Hevy sent something this import can't read/)).toBeInTheDocument();
  });
});

describe("20.1 AC13 — unpaired remains", () => {
  it("lists the templates, disables Import, and Back to names shows the card", async () => {
    const workouts = generateHevyWorkouts(20);
    const missing = GENERATED_TEMPLATE_IDS[0];
    const s = setup({ workouts, imports: { pairedTemplateIds: new Set(GENERATED_TEMPLATE_IDS.slice(1)) } });
    const { user } = await start();
    await summaryHeading();
    expect(screen.getByText(/Hevy exercises? (isn't|aren't) paired/)).toBeInTheDocument();
    expect(screen.getByText(`Template ${missing}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import / })).toBeDisabled();
    s.removePair(missing);
    await user.click(screen.getByRole("button", { name: "Back to names" }));
    expect(await screen.findByRole("group", { name: `Template ${missing}` })).toBeInTheDocument();
  });
});

describe("Minor 249 — Import is the summary's one primary button", () => {
  it("only the confirm button is primary", async () => {
    setup({ workouts: generateHevyWorkouts(6) });
    await start();
    await summaryHeading();
    const step = screen.getByRole("region", { name: "Summary" });
    const primary = within(step).getAllByRole("button").filter((b) => b.dataset.variant === "primary");
    expect(primary.map((b) => b.textContent)).toEqual(["Import 6 workouts"]);
  });
});

describe("Minor 244 — unpaired templates are keyed by id", () => {
  it("two unpaired templates with one title are two rows, with no key warning", async () => {
    const [a, b] = GENERATED_TEMPLATE_IDS;
    // A built-in and a custom "Bench Press": same title, different ids, both unpaired.
    const same = templates.map((t) => (t.id === a || t.id === b ? { ...t, title: "Bench Press" } : t));
    setup({ workouts: generateHevyWorkouts(20), templates: same, imports: { pairedTemplateIds: new Set(GENERATED_TEMPLATE_IDS.slice(2)) } });
    const error = vi.spyOn(console, "error");
    await start();
    await summaryHeading();
    const card = screen.getByText(/Hevy exercises? (isn't|aren't) paired/).parentElement!;
    expect(within(card).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Bench Press", "Bench Press"]);
    expect(error.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    error.mockRestore();
  });
});

describe("20.1 AC13 — code review 3: a slow Back to names", () => {
  it("never pulls the lifter off a step they moved to while the mapping was re-read", async () => {
    const routines: HevyRoutine[] = [{ id: "r1", title: "Push A", folder_id: null, exercises: [{ index: 0, title: "x", exercise_template_id: GENERATED_TEMPLATE_IDS[1], sets: [] }] }];
    setup({ workouts: generateHevyWorkouts(6), routines, imports: { pairedTemplateIds: new Set(GENERATED_TEMPLATE_IDS.slice(1)) } });
    const { user } = await start();
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await summaryHeading();
    let release: () => void = () => {};
    server.use(
      http.get(MAPPING_URL, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ pairs: GENERATED_TEMPLATE_IDS.map(pairOf), sectionRules: [] });
      }),
    );
    await user.click(screen.getByRole("button", { name: "Back to names" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Routines to copy" })).toBeInTheDocument();
    release();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByRole("heading", { level: 2, name: "Routines to copy" })).toBeInTheDocument();
  });
});

describe("20.1 AC14 — confirm", () => {
  it("says what would be imported; Back to routines keeps the ticks", async () => {
    const routines: HevyRoutine[] = [{ id: "r1", title: "Push A", folder_id: null, exercises: [{ index: 0, title: "x", exercise_template_id: GENERATED_TEMPLATE_IDS[0], sets: [] }] }];
    setup({ workouts: generateHevyWorkouts(12), routines });
    const { user } = await start();
    await user.click(await screen.findByRole("checkbox", { name: "Push A" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await summaryHeading();
    expect(screen.getByRole("button", { name: "Import 12 workouts and 1 routine" })).toBeEnabled();
    expect(screen.getByText("1 routine will be created.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("checkbox", { name: "Push A" })).toBeChecked();
  });

  it("final review C1: Back from the summary, then Continue, checks again and returns to the summary", async () => {
    const routines: HevyRoutine[] = [{ id: "r1", title: "Push A", folder_id: null, exercises: [{ index: 0, title: "x", exercise_template_id: GENERATED_TEMPLATE_IDS[0], sets: [] }] }];
    const { imports } = setup({ workouts: generateHevyWorkouts(6), routines });
    const { user } = await start();
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await summaryHeading();
    const before = bodies(imports.log).length;
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(await screen.findByRole("checkbox", { name: "Push A" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await summaryHeading();
    expect(bodies(imports.log).length).toBe(before + 1);
    expect(screen.getByRole("button", { name: "Import 6 workouts and 1 routine" })).toBeInTheDocument();
  });

  it("final review I1: with every workout waiting for a pairing it never says Nothing new", async () => {
    setup({ workouts: generateHevyWorkouts(4), imports: { pairedTemplateIds: new Set() } });
    await start();
    await summaryHeading();
    expect(screen.getByRole("button", { name: "Back to names" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing new to import")).toBeNull();
    expect(screen.queryByRole("link", { name: "Done" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Import / })).toBeDisabled();
  });

  it("with nothing new it says so and Done goes back to Hevy", async () => {
    const workouts = generateHevyWorkouts(4);
    setup({ workouts, imports: { links: workouts.map((w) => ({ hevyWorkoutId: w.id, origin: "imported" as const })) } });
    await start();
    await summaryHeading();
    expect(screen.getAllByText("Nothing new to import").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute("href", HEVY_PATH);
  });

  it("an account with no Hevy workouts reaches the same end", async () => {
    setup({ workouts: [] });
    await start();
    await summaryHeading();
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute("href", HEVY_PATH);
  });
});

describe("20.1 AC28 — stale summary", () => {
  it("a mapping change after the summary asks to check again", async () => {
    const { imports } = setup({ workouts: generateHevyWorkouts(5) });
    const { user, queryClient } = await start();
    await summaryHeading();
    act(() => {
      // A PATCH reply written to the cache (equal data keeps its reference through structural sharing, so it must differ).
      queryClient.setQueryData(HEVY_KEYS.mapping, { pairs: [...GENERATED_TEMPLATE_IDS.map(pairOf), { ...pairOf("EXTRA"), role: "skip", exerciseId: null, exerciseActive: null }], sectionRules: [] });
    });
    expect(await screen.findByText(SUMMARY_STALE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 5 workouts" })).toBeDisabled();
    const before = bodies(imports.log).length;
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(bodies(imports.log).length).toBe(before + 1));
    await summaryHeading();
    await waitFor(() => expect(screen.queryByText(SUMMARY_STALE)).toBeNull());
  });
});

describe("20.1 AC15 — no router state", () => {
  it("never puts Hevy data in the history", async () => {
    setup({ workouts: generateHevyWorkouts(3) });
    const { router } = await start();
    await summaryHeading();
    expect(router.state.location.state).toBeNull();
    expect(JSON.stringify(window.history.state ?? null)).not.toContain("workouts");
  });
});
