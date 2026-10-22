import { screen, within } from "@testing-library/react";
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
const observability = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));

import { RoutineWriteSchema } from "@sin/core";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { importCatalog, readHiraya, toEditor } from "../../../test/importFixtures";
import { addFromPicker } from "../../../test/routineHarness";
import { catalog as routineCatalog, pushA } from "../../../test/routineFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { KEEP_AS_ROUTINE, ONE_OFF_TAG, SAVE_FAILED } from "../messages";
import { IMPORT_PATH, NEW_ROUTINE_PATH } from "../paths";
import { OPEN_ANYWAY } from "./messages";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

function start(catalog = [...importCatalog], path = IMPORT_PATH, routines: (typeof pushA)[] = []) {
  const fake = createWorkoutFake({ catalog, serveExercises: true, routines });
  prepareApp({ auth, fake, catalog });
  const app = renderApp(path);
  const writes = () => fake.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`);
  const routinePosts = () => fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/routines").map((r) => r.body as Record<string, unknown>);
  return { fake, writes, routinePosts, ...app };
}

const save = () => screen.getByRole("button", { name: "Save" });
const matchedAll = () => [
  ...importCatalog,
  ...["Hand Release Pushups", "Front Raise", "Reverse Fly"].map((name, i) => makeExercise({ id: exerciseId(40 + i), name, primaryMuscleId: null, equipmentId: null })),
];

describe("10.5 AC17 — every import create is a one-off", () => {
  it("with pending exercises: N exercise POSTs, then one routine POST = a plain write body + oneOff", async () => {
    const { user, writes, routinePosts } = start();
    await toEditor(user);
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    expect(writes()).toEqual(["POST /v1/exercises", "POST /v1/exercises", "POST /v1/exercises", "POST /v1/routines"]);
    const body = routinePosts()[0]!;
    expect(body["oneOff"]).toBe(true);
    const rest: Record<string, unknown> = { ...body };
    delete rest["oneOff"];
    expect(RoutineWriteSchema.safeParse(rest).success).toBe(true);
  });

  it("with no pending exercises: one POST, oneOff: true", async () => {
    const { user, writes, routinePosts } = start(matchedAll());
    await toEditor(user);
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    expect(writes()).toEqual(["POST /v1/routines"]);
    expect(routinePosts()[0]!["oneOff"]).toBe(true);
  });

  it("Open in the editor anyway, once an exercise is added", async () => {
    const { user, routinePosts } = start();
    await readHiraya(user, "11:41\nWarmup\n400m easy Run\nthen 2 Rounds\n- 10 Arm Circles\nCooldown\nWalk it off.\nHome");
    await user.click(await screen.findByRole("button", { name: OPEN_ANYWAY }));
    await screen.findByRole("heading", { level: 1, name: "New routine" });
    await addFromPicker(user, new RegExp(importCatalog[0]!.name));
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Open anyway");
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Open anyway" });
    expect(routinePosts()[0]!["oneOff"]).toBe(true);
  });

  it("a retry after a failed create keeps it", async () => {
    const { user, fake, routinePosts } = start(matchedAll());
    fake.failNext({ method: "POST", path: /^\/v1\/routines$/ }, () => problemResponse(500, "about:blank"));
    await toEditor(user);
    await user.click(save());
    expect(await screen.findByText(SAVE_FAILED)).toBeInTheDocument();
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    expect(routinePosts().map((b) => b["oneOff"])).toEqual([true, true]);
  });
});

describe("10.5 AC18 — nothing else sends it", () => {
  it("New routine POST and an edit's PUT carry no oneOff key", async () => {
    const { user, fake } = start([...routineCatalog], NEW_ROUTINE_PATH, [pushA]);
    await screen.findByRole("heading", { level: 1, name: "New routine" });
    await addFromPicker(user, /Bench Press/);
    await user.type(screen.getByLabelText("Name"), "Legs");
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Legs" });
    const post = fake.requests.find((r) => r.method === "POST" && r.path === "/v1/routines")!;
    expect(Object.keys(post.body as object)).not.toContain("oneOff");

    await user.click(screen.getByRole("link", { name: "Back to Workouts" }));
    await user.click(await screen.findByRole("link", { name: /Push A/ }));
    await user.click(await screen.findByRole("link", { name: "Edit" }));
    await user.type(await screen.findByLabelText("Name"), "!");
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Push A!" });
    const put = fake.requests.find((r) => r.method === "PUT")!;
    expect(Object.keys(put.body as object)).not.toContain("oneOff");
  });
});

describe("10.5 AC19 — the saved import shows as a one-off", () => {
  it("the preview has the tag, the note and Keep; the list shows it first, tagged", async () => {
    const { user } = start(matchedAll(), IMPORT_PATH, [pushA]);
    await toEditor(user);
    await user.click(save());
    // The screen's own region: a routine section is also named "Second Shift".
    const region = (await screen.findByRole("heading", { level: 1, name: "Second Shift" })).closest("section")!;
    expect(within(region).getByText(ONE_OFF_TAG)).toBeInTheDocument();
    expect(within(region).getByText(/^Leaves your routines when you finish a workout from it, or after 14 days/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: KEEP_AS_ROUTINE })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Back to Workouts" }));
    const links = within(await screen.findByRole("list", { name: "Routines" })).getAllByRole("link");
    expect(links[0]).toHaveTextContent(/^Second Shift One-off/);
    expect(links[0]).toHaveTextContent(/· from text · until /);
  });
});
