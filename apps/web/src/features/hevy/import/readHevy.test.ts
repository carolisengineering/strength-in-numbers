import { beforeEach, describe, expect, it, vi } from "vitest";
import { HevyFolderPageSchema, HevyRoutinePageSchema, type HevyTemplate } from "@sin/core";
import { QueryClient } from "@tanstack/react-query";

import { hevyFixtures } from "../../../test/hevyFixtures";
import { setInstantPacing, VALID_KEY } from "../../../test/hevyHarness";
import { fakeHevyApi, generateHevyWorkouts, type HevyFakeFixture } from "../../../test/hevyImportFakes";
import { server } from "../../../test/msw/server";
import { HevyError } from "../client/hevyErrors";
import { HEVY_GET_RETRY_WAITS_MS } from "../client/pacer";
import { hevyTemplatesQuery } from "../mapping/useHevyTemplates";
import { HEVY_KEYS } from "../keys";
import { hevyClientFor } from "../sharedClient";
import { readHevy, ReadStageError, reconcile, type HevyRead } from "./readHevy";

const templates = (hevyFixtures.templatesPage() as { exercise_templates: unknown[] }).exercise_templates;
const folders = HevyFolderPageSchema.parse(hevyFixtures.foldersPage()).routine_folders;
const routines = HevyRoutinePageSchema.parse(hevyFixtures.routinesPage()).routines;

function setup(over: HevyFakeFixture = {}) {
  const fake = fakeHevyApi({ templates, folders, routines, workouts: generateHevyWorkouts(34), ...over });
  server.use(...fake.handlers);
  const client = hevyClientFor(() => VALID_KEY);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const templatesRead = (): Promise<HevyTemplate[]> => queryClient.fetchQuery(hevyTemplatesQuery(client));
  return { fake, client, queryClient, templatesRead };
}

const read = (s: ReturnType<typeof setup>, extra: Partial<Parameters<typeof readHevy>[1]> = {}) => {
  const controller = new AbortController();
  return readHevy(s.client, { signal: controller.signal, templates: s.templatesRead, onProgress: () => {}, ...extra });
};

/** The first try and every retry the client makes. */
const EVERY_TRY = 1 + HEVY_GET_RETRY_WAITS_MS.length;

beforeEach(() => setInstantPacing());

describe("20.1 AC3 — reading order and progress", () => {
  it("reads count, templates, folders, routines, then workouts page by page", async () => {
    const s = setup();
    const progress = vi.fn();
    const result = await read(s, { onProgress: progress });
    expect(s.fake.log.map((r) => r.path)).toEqual([
      "/v1/workouts/count",
      "/v1/exercise_templates",
      "/v1/routine_folders",
      "/v1/routines",
      "/v1/workouts",
      "/v1/workouts",
      "/v1/workouts",
      "/v1/workouts",
    ]);
    expect(s.fake.log.find((r) => r.path === "/v1/exercise_templates")?.pageSize).toBe(100);
    expect(s.fake.log.filter((r) => r.path === "/v1/workouts").map((r) => [r.page, r.pageSize])).toEqual([
      [1, 10],
      [2, 10],
      [3, 10],
      [4, 10],
    ]);
    expect(progress.mock.calls.map(([p]) => p)).toEqual([
      { stage: "count", page: 0, pageCount: 0 },
      { stage: "templates", page: 0, pageCount: 0 },
      { stage: "folders", page: 1, pageCount: 1 },
      { stage: "routines", page: 1, pageCount: 1 },
      { stage: "workouts", page: 1, pageCount: 4 },
      { stage: "workouts", page: 2, pageCount: 4 },
      { stage: "workouts", page: 3, pageCount: 4 },
      { stage: "workouts", page: 4, pageCount: 4 },
    ]);
    expect(result.workoutCount).toBe(34);
    expect(result.workouts.size).toBe(34);
    expect(result.templates.size).toBe(templates.length);
    expect(result.folders).toEqual(folders);
    expect(result.routines).toEqual(routines);
  });

  it("reuses templates already in the cache", async () => {
    const s = setup();
    s.queryClient.setQueryData(HEVY_KEYS.templates, []);
    await read(s);
    expect(s.fake.log.some((r) => r.path === "/v1/exercise_templates")).toBe(false);
  });

  it("an abort during workouts page 3 rejects as aborted and sends nothing more", async () => {
    const s = setup();
    const controller = new AbortController();
    const done = readHevy(s.client, {
      signal: controller.signal,
      templates: s.templatesRead,
      onProgress: (p) => {
        if (p.stage === "workouts" && p.page === 2) controller.abort();
      },
    });
    await expect(done).rejects.toMatchObject({ kind: "aborted" });
    const sent = s.fake.log.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(s.fake.log.length).toBe(sent);
    expect(s.fake.log.filter((r) => r.path === "/v1/workouts").map((r) => r.page)).toEqual([1, 2]);
  });

  it("an abort while the templates read is pending rejects at once", async () => {
    const s = setup();
    const controller = new AbortController();
    const done = readHevy(s.client, {
      signal: controller.signal,
      templates: () => new Promise<never>(() => {}),
      onProgress: (p) => {
        if (p.stage === "templates") controller.abort();
      },
    });
    await expect(done).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("20.1 AC4 — reconciliation", () => {
  it("a workout served again after a shift is counted once", async () => {
    const workouts = generateHevyWorkouts(30);
    const s = setup({ workouts, count: 30 });
    s.fake.shiftAfterPage(2, { ...generateHevyWorkouts(1, 9)[0]!, id: "new-one" });
    const result = await read(s);
    const servedIds = s.fake.log.filter((r) => r.path === "/v1/workouts").length;
    expect(servedIds).toBe(4);
    // Page 3 repeats page 2's last workout; the new one sits on page 1, already read; the last old one moved to page 4.
    expect(result.workouts.size).toBe(30);
    expect(result.workouts.has("new-one")).toBe(false);
    expect(reconcile(result)).toEqual({ read: 30, reported: 30, differs: false });
  });

  it("a count that differs from the distinct ids read differs", async () => {
    const s = setup({ workouts: generateHevyWorkouts(12), count: 13 });
    const result = await read(s);
    expect(reconcile(result)).toEqual({ read: 12, reported: 13, differs: true });
  });

  it("an unchanged account does not differ", async () => {
    const s = setup({ workouts: generateHevyWorkouts(12) });
    expect(reconcile(await read(s))).toEqual({ read: 12, reported: 12, differs: false });
  });
});

describe("20.1 AC5 — read failures", () => {
  it("a 500 that outlasts the retries on routines page 1 is a ReadStageError for routines", async () => {
    const s = setup();
    s.fake.failNext("/v1/routines", 500, EVERY_TRY);
    const failure = await read(s).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ReadStageError);
    expect(failure).toMatchObject({ stage: "routines", cause: { kind: "server" } });
  });

  it("from: routines restarts that stage with the earlier results", async () => {
    const s = setup();
    s.fake.failNext("/v1/routines", 500, EVERY_TRY);
    const failure = (await read(s).catch((e: unknown) => e)) as ReadStageError;
    s.fake.log.length = 0;
    const result = await read(s, { from: failure.stage, previous: failure.partial });
    expect(s.fake.log[0]).toEqual({ path: "/v1/routines", page: 1, pageSize: 10 });
    expect(s.fake.log.some((r) => r.path === "/v1/workouts/count" || r.path === "/v1/routine_folders")).toBe(false);
    expect(result.workoutCount).toBe(34);
    expect(result.folders).toEqual(folders);
    expect(result.workouts.size).toBe(34);
  });

  it("a 401 rejects as bad_key", async () => {
    const s = setup();
    s.fake.failNext("/v1/workouts/count", 401);
    await expect(read(s)).rejects.toSatisfy((e) => e instanceof HevyError && e.kind === "bad_key");
  });

  it("a page that fails the schema rejects as unexpected_reply", async () => {
    const s = setup();
    s.fake.failNext("/v1/routine_folders", "garbage");
    await expect(read(s)).rejects.toSatisfy((e) => e instanceof HevyError && e.kind === "unexpected_reply");
  });

  it("a network failure that outlasts the retries is a ReadStageError with cause network", async () => {
    const s = setup();
    s.fake.failNext("/v1/workouts", "network", EVERY_TRY);
    const failure = await read(s).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ReadStageError);
    expect(failure).toMatchObject({ stage: "workouts", cause: { kind: "network" } });
  });

  it("a failed template read is a ReadStageError for templates", async () => {
    const s = setup();
    s.fake.failNext("/v1/exercise_templates", 503, EVERY_TRY);
    const failure = await read(s).catch((e: unknown) => e);
    expect(failure).toMatchObject({ stage: "templates", cause: { kind: "server" } });
  });
});

describe("20.1 AC3 — nothing stored", () => {
  it("a full read writes nothing to storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const s = setup();
    const result: HevyRead = await read(s);
    expect(result.workouts.size).toBe(34);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
