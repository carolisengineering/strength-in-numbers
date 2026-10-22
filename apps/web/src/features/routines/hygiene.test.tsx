import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { makeRoutine, makeRoutineItem, makeSet, makeWorkoutDetail, routineId } from "../../test/workoutFixtures";
import { finishButton } from "../../test/sessionHelpers";
import { USER_DATA_KEY_PREFIXES } from "../../storage/clearUserData";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { catalog, pushA } from "../../test/routineFixtures";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const HERE = dirname(fileURLToPath(import.meta.url));
const sources = () =>
  readdirSync(HERE)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => [f, readFileSync(join(HERE, f), "utf8")] as const);

describe("10.0 AC37 — no inline styles", () => {
  it("non-test sources under features/routines", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(5);
    for (const [file, text] of files) expect(text, file).not.toMatch(/\bstyle\s*=|<style|dangerouslySetInnerHTML/);
  });
});

describe("10.0 AC35 — nothing in features/routines persists", () => {
  it("no browser-storage names, no persister", () => {
    for (const [file, text] of sources()) expect(text, file).not.toMatch(/localStorage|sessionStorage|Persister|persistQueryClient/);
  });
});

describe("10.0 AC38 — reports and analytics carry static tags only", () => {
  it("every routine failure path reports without ids, names or notes", async () => {
    const secret = "Secret Routine Name";
    const routine = { ...pushA, name: secret, notes: "secret note" };
    const fake = createWorkoutFake({ catalog, routines: [routine] });
    fake.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => problemResponse(418, "teapot"));
    fake.failNext({ method: "GET", path: /^\/v1\/routines\/./ }, () => problemResponse(418, "teapot"));
    fake.failNext({ method: "DELETE", path: /^\/v1\/routines\/./ }, () => problemResponse(418, "teapot"));
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(`/app/workouts/routines/${routineId(1)}`);
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await screen.findByText("Couldn't delete this routine — try again.");
    expect(observability.reportError).toHaveBeenCalled();
    for (const [, context] of observability.reportError.mock.calls) {
      expect(Object.keys(context as object).sort()).toEqual(["op", "source"]);
      const text = JSON.stringify(context);
      expect(text).not.toContain(secret);
      expect(text).not.toContain(routineId(1));
    }
    for (const [event] of observability.track.mock.calls) expect(event).toBe("workout_started");
  });
});

describe("10.5 AC22 — storage, privacy, text as text", () => {
  const SECRET = "Zanzibar Quokka Class";
  const secretOneOff = makeRoutine({
    id: routineId(60),
    name: SECRET,
    notes: "Zanzibar notes",
    oneOffUntil: "2099-10-30T12:00:00.000Z",
    items: [makeRoutineItem({ exerciseId: catalog[0]!.id })],
  });
  const consoleSpies = () => (["error", "warn", "log", "info"] as const).map((m) => vi.spyOn(console, m));
  const leaked = (spies: ReturnType<typeof consoleSpies>, writes: unknown[]) =>
    JSON.stringify([observability.track.mock.calls, observability.reportError.mock.calls, spies.map((s) => s.mock.calls), writes]);

  it("no new storage key prefix", () => expect(USER_DATA_KEY_PREFIXES).toEqual(["sin:catalog:", "sin:recents:", "sin:workout:"]));

  it("the list, the preview and Keep (failing, then succeeding) leak no routine text", async () => {
    const spies = consoleSpies();
    const writes: unknown[] = [];
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      writes.push([key, value]);
    });
    const fake = createWorkoutFake({ catalog, routines: [secretOneOff, pushA] });
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp("/app/workouts");
    await user.click(await screen.findByRole("link", { name: new RegExp(SECRET) }));
    fake.failNext({ method: "POST", path: /\/keep$/ }, () => problemResponse(500, "about:blank"));
    fake.failNext({ method: "POST", path: /\/keep$/ }, () => problemResponse(418, "teapot"));
    await user.click(await screen.findByRole("button", { name: "Keep as a routine" }));
    await user.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Retry" }));
    await screen.findByRole("alert");
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Kept in your routines.")).toBeInTheDocument();
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(leaked(spies, writes)).not.toContain("Zanzibar");
    setItem.mockRestore();
    for (const s of spies) s.mockRestore();
  });

  it("the Finish dialog's checked, failing then retried finish leaks no routine text", async () => {
    const spies = consoleSpies();
    const writes: unknown[] = [];
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      writes.push([key, value]);
    });
    const active = makeWorkoutDetail({ routineName: SECRET, routineIsOneOff: true, exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }] });
    const fake = createWorkoutFake({ catalog, routines: [secretOneOff], active, activeRoutineId: secretOneOff.id });
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    fake.failNext({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ }, () => problemResponse(500, "about:blank"));
    await user.click(finishButton());
    const dialog = screen.getByRole("dialog", { name: "Finish workout?" });
    expect(within(dialog).getByText(`'${SECRET}' is a one-off: it leaves your routines when you finish.`)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "Keep it in my routines" }));
    await user.click(within(dialog).getByRole("button", { name: "Finish" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(leaked(spies, writes)).not.toContain("Zanzibar");
    setItem.mockRestore();
    for (const s of spies) s.mockRestore();
  });

  it("the added files have no HTML path or inline style", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const path of ["oneOff.ts", "RoutinesSection.tsx", "RoutinePreview.tsx", "../workouts/FinishDialog.tsx"]) {
      expect(strip(readFileSync(join(HERE, path), "utf8")), path).not.toMatch(/dangerouslySetInnerHTML|innerHTML|style=|<style/);
    }
  });
});

describe("10.5 AC23 — observability", () => {
  it("a kept finish tracks only workout_finished, with its usual properties", async () => {
    const cls = makeRoutine({ id: routineId(61), name: "Class", oneOffUntil: "2099-10-30T12:00:00.000Z", items: [makeRoutineItem({ exerciseId: catalog[0]!.id })] });
    const active = makeWorkoutDetail({ routineName: cls.name, routineIsOneOff: true, exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }] });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [cls], active, activeRoutineId: cls.id }) });
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    observability.track.mockReset();
    await user.click(finishButton());
    const dialog = screen.getByRole("dialog", { name: "Finish workout?" });
    await user.click(within(dialog).getByRole("checkbox", { name: "Keep it in my routines" }));
    await user.click(within(dialog).getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(observability.track.mock.calls.map(([event]) => event)).toEqual(["workout_finished"]);
    expect(Object.keys(observability.track.mock.calls[0]![1] as object).sort()).toEqual([
      "durationMin",
      "endedEarly",
      "exerciseCount",
      "hadPlannedDuration",
      "setCount",
      "unloggedPlannedSets",
    ]);
    expect(observability.reportError).not.toHaveBeenCalled();
  });
});
