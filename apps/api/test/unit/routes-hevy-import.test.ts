import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { HevyImportWorkout } from "@sin/core";
import { CORS_METHODS } from "../../src/plugins/cors-methods.js";
import { limitsWith } from "../helpers/build-test-app.js";
import { FakeHevyImportRepository } from "../helpers/fakes.js";
import { AS_A, AS_B, buildHevyApp, USER_A } from "../helpers/hevy-users.js";

const BATCH_URL = "/v1/hevy/import/workouts";
const FINISH_URL = "/v1/hevy/import/finish";

const workout = (over: Partial<HevyImportWorkout> = {}): HevyImportWorkout => ({
  hevyWorkoutId: "b459cba5-cd6d-463c-abd6-54f8eafcadcb",
  title: "Push day",
  description: null,
  startTime: "2026-09-10T10:00:00Z",
  endTime: "2026-09-10T11:00:00Z",
  tzOffsetMinutes: 0,
  exercises: [
    {
      exerciseTemplateId: "D04AC939",
      notes: null,
      supersetId: null,
      sets: [{ type: "normal", weightKg: 60, reps: 5, distanceMeters: null, durationSeconds: null, rpe: null, customMetric: null }],
    },
  ],
  ...over,
});
const batch = (workouts: HevyImportWorkout[] = [workout()], dryRun = false) => ({ dryRun, workouts });

async function setup(opts: Parameters<typeof buildHevyApp>[0] = {}) {
  const imports = new FakeHevyImportRepository();
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const logger = pino({ level: "info" }, { write: (s: string) => (raw.push(s), lines.push(JSON.parse(s))) });
  const { app } = await buildHevyApp({ hevyImportRepository: imports, logger, ...opts });
  return { app, imports, lines, raw };
}

describe("19.1 AC15 — gate, group, publication, limits, validation", () => {
  it.each([BATCH_URL, FINISH_URL])("POST %s for a user not on the list is 404, even with a malformed body", async (url) => {
    const { app, imports } = await setup();
    expect((await app.inject({ method: "POST", url, headers: AS_B, payload: batch() })).statusCode).toBe(404);
    const bad = await app.inject({ method: "POST", url, headers: { ...AS_B, "content-type": "application/json" }, payload: "{" });
    expect(bad.statusCode).toBe(404);
    expect(imports.batches).toEqual([]);
    expect(imports.finishes).toEqual([]);
  });

  it("an allowed user's batch reaches the repository and answers its results", async () => {
    const { app, imports } = await setup();
    const res = await app.inject({ method: "POST", url: BATCH_URL, headers: AS_A, payload: batch([workout()], true) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      dryRun: true,
      results: [
        {
          hevyWorkoutId: "b459cba5-cd6d-463c-abd6-54f8eafcadcb",
          outcome: "create",
          workoutId: null,
          matchedWorkoutId: null,
          unpaired: [],
          drops: [],
          notices: [],
          exerciseCount: 1,
          setCount: 1,
        },
      ],
    });
    expect(imports.batches.map((b) => b.userId)).toEqual([USER_A]);
  });

  it("finish takes no body and answers the repository's result", async () => {
    const { app, imports } = await setup();
    const res = await app.inject({ method: "POST", url: FINISH_URL, headers: AS_A });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recomputed: true, rootCount: 3 });
    expect(imports.finishes).toEqual([USER_A]);
  });

  it.each([
    ["no workouts", batch([])],
    ["26 workouts", batch(Array.from({ length: 26 }, (_, i) => workout({ hevyWorkoutId: `h-${i}` })))],
    ["an unknown key", { ...batch(), extra: true }],
    ["a bad value", batch([workout({ tzOffsetMinutes: 9999 })])],
    ["no dryRun", { workouts: [workout()] }],
  ])("%s is 422 and the repository sees nothing", async (_label, payload) => {
    const { app, imports } = await setup();
    const res = await app.inject({ method: "POST", url: BATCH_URL, headers: AS_A, payload });
    expect(res.statusCode).toBe(422);
    expect(imports.batches).toEqual([]);
  });

  it("a body over 512 KiB is 413", async () => {
    const { app, imports } = await setup();
    const res = await app.inject({
      method: "POST",
      url: BATCH_URL,
      headers: { ...AS_A, "content-type": "application/json" },
      payload: JSON.stringify(batch([workout({ description: "x".repeat(513 * 1024) })])),
    });
    expect(res.statusCode).toBe(413);
    expect(imports.batches).toEqual([]);
  });

  it("both routes count against the hevy write group", async () => {
    const { app } = await setup({ rateLimits: limitsWith({ groups: { hevy: 1 } }) });
    expect((await app.inject({ method: "POST", url: BATCH_URL, headers: AS_A, payload: batch() })).statusCode).toBe(200);
    const second = await app.inject({ method: "POST", url: FINISH_URL, headers: AS_A });
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
  });

  it("neither route is in the published API document, and POST is a CORS method", async () => {
    const { app } = await setup();
    await app.ready();
    const paths = Object.keys((app.swagger() as { paths?: Record<string, unknown> }).paths ?? {});
    expect(paths.filter((p) => p.includes("import"))).toEqual([]);
    expect(CORS_METHODS).toContain("POST");
  });
});

describe("19.1 AC32 — logs", () => {
  it("a batch logs one hevy_import_batch line with counts only", async () => {
    const { app, lines } = await setup();
    await app.inject({ method: "POST", url: BATCH_URL, headers: AS_A, payload: batch([workout(), workout({ hevyWorkoutId: "h-2" })], true) });
    const logged = lines.filter((l) => l.msg === "hevy_import_batch");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 30,
      user_id: USER_A,
      dry_run: true,
      workouts: 2,
      outcomes: { create: 2 },
      sets_created: 2,
      sets_dropped: 0,
      ms: expect.any(Number),
    });
  });

  it("a finish logs hevy_import_finished", async () => {
    const { app, lines } = await setup();
    await app.inject({ method: "POST", url: FINISH_URL, headers: AS_A });
    expect(lines.filter((l) => l.msg === "hevy_import_finished")).toEqual([
      expect.objectContaining({ level: 30, user_id: USER_A, recomputed: true, root_count: 3, ms: expect.any(Number) }),
    ]);
  });
});

describe("19.1 AC35 — static messages and redaction", () => {
  it("no log line or 422 body carries a Hevy title, note or id", async () => {
    const { app, raw } = await setup();
    const secret = workout({
      hevyWorkoutId: "SECRET-ID",
      title: "SECRET-TITLE",
      description: "SECRET-NOTE",
      exercises: [{ exerciseTemplateId: "SECRET-ID", notes: "SECRET-NOTE", supersetId: null, sets: [] }],
    });
    const ok = await app.inject({ method: "POST", url: BATCH_URL, headers: AS_A, payload: batch([secret]) });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({ method: "POST", url: BATCH_URL, headers: AS_A, payload: batch([{ ...secret, tzOffsetMinutes: 9999 }]) });
    expect(bad.statusCode).toBe(422);
    const text = raw.join("\n") + bad.body;
    for (const s of ["SECRET-ID", "SECRET-TITLE", "SECRET-NOTE"]) expect(text).not.toContain(s);
  });
});
