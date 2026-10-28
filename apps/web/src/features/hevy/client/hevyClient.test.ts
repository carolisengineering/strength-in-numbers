import { describe, expect, it, vi } from "vitest";
import type { HevyCreateTemplateBody, HevyPostWorkout } from "@sin/core";
import { hevyFixtures, jsonReply } from "./fixtures";
import { createHevyClient, HEVY_ORIGIN, type HevyClientDeps } from "./hevyClient";
import { createPacer, type Pacer } from "./pacer";

const KEY = "5ec7e7a1-0b5e-4c3d-9a8f-1234deadbeef";
const POST: HevyPostWorkout = {
  workout: { title: "Push", description: null, start_time: "2026-10-28T10:00:00Z", end_time: "2026-10-28T11:00:00Z", is_private: false, exercises: [] },
};
const TEMPLATE: HevyCreateTemplateBody = {
  exercise: { title: "Echo Bike", exercise_type: "reps_only", equipment_category: "machine", muscle_group: "cardio", other_muscles: [] },
};

/** A client over a fake fetch that answers `replies` in order and records every call; the clock never waits. */
function harness(replies: (Response | Error)[], opts: { key?: string | null; pacer?: Pacer } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  let now = Date.parse("2026-10-28T12:30:00.000Z");
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = replies.shift();
    if (next === undefined) throw new Error("no reply queued");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = async (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    sleeps.push(ms);
    now += ms;
  };
  const pacer = opts.pacer ?? createPacer({ now: () => now, sleep: async (ms) => void (now += ms) });
  const deps: HevyClientDeps = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    getKey: () => (opts.key === undefined ? KEY : opts.key),
    pacer,
    sleep,
    now: () => now,
  };
  return { client: createHevyClient(deps), calls, sleeps, fetch, pacer };
}

describe("20.0 AC8 — requests", () => {
  const cases: [string, (c: ReturnType<typeof createHevyClient>) => Promise<unknown>, Response, string, string][] = [
    ["userInfo", (c) => c.userInfo(), jsonReply(hevyFixtures.userInfo()), "GET", "/v1/user/info"],
    ["workoutCount", (c) => c.workoutCount(), jsonReply({ workout_count: 42 }), "GET", "/v1/workouts/count"],
    ["listTemplates", (c) => c.listTemplates(2), jsonReply(hevyFixtures.templatesPage()), "GET", "/v1/exercise_templates?page=2&pageSize=100"],
    ["listWorkouts", (c) => c.listWorkouts(1), jsonReply(hevyFixtures.workoutsPage()), "GET", "/v1/workouts?page=1&pageSize=10"],
    ["listRoutines", (c) => c.listRoutines(3), jsonReply(hevyFixtures.routinesPage()), "GET", "/v1/routines?page=3&pageSize=10"],
    ["listFolders", (c) => c.listFolders(1), jsonReply(hevyFixtures.foldersPage()), "GET", "/v1/routine_folders?page=1&pageSize=10"],
    ["createWorkout", (c) => c.createWorkout(POST), jsonReply(hevyFixtures.createWorkoutReply()), "POST", "/v1/workouts"],
    ["updateWorkout", (c) => c.updateWorkout("a/b c", POST), jsonReply(hevyFixtures.updateWorkoutReply()), "PUT", "/v1/workouts/a%2Fb%20c"],
    ["createTemplate", (c) => c.createTemplate(TEMPLATE), jsonReply({ id: 123 }), "POST", "/v1/exercise_templates"],
  ];

  it.each(cases)("%s goes to Hevy with exactly the key, Accept and (with a body) Content-Type", async (_n, call, reply, method, path) => {
    const h = harness([reply]);
    await call(h.client);
    expect(h.calls).toHaveLength(1);
    const { url, init } = h.calls[0]!;
    expect(url).toBe(`${HEVY_ORIGIN}${path}`);
    expect(init.method).toBe(method);
    const headers = init.headers as Record<string, string>;
    const expected: Record<string, string> = { "api-key": KEY, Accept: "application/json" };
    if (method !== "GET") expected["Content-Type"] = "application/json";
    expect(headers).toEqual(expected);
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    if (method === "GET") expect(init.body).toBeUndefined();
  });

  it.each(cases)("%s with no key rejects bad_key and makes no request", async (_n, call) => {
    const h = harness([], { key: null });
    await expect(call(h.client)).rejects.toMatchObject({ kind: "bad_key" });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("20.0 AC8 — replies are parsed", () => {
  it("each fixture parses into the documented shape", async () => {
    const h = harness([
      jsonReply(hevyFixtures.userInfo()),
      jsonReply({ workout_count: 42 }),
      jsonReply(hevyFixtures.createWorkoutReply()),
      jsonReply(hevyFixtures.updateWorkoutReply()),
      jsonReply({ id: 123 }),
    ]);
    expect((await h.client.userInfo()).data).toMatchObject({ username: "jhon", is_pro: true });
    expect(await h.client.workoutCount()).toBe(42);
    expect((await h.client.createWorkout(POST)).id).toBe("b459cba5-cd6d-463c-abd6-54f8eafcadcb");
    expect((await h.client.updateWorkout("x", POST)).id).toEqual(expect.any(String));
    expect(await h.client.createTemplate(TEMPLATE)).toEqual({ id: "123" });
  });

  it("a reply missing a required field, of the wrong type, or not JSON is unexpected_reply", async () => {
    const h = harness([
      jsonReply({ data: { id: "x" } }),
      jsonReply({ workout_count: "many" }),
      new Response("<html>oops</html>", { status: 200 }),
    ]);
    await expect(h.client.userInfo()).rejects.toMatchObject({ kind: "unexpected_reply" });
    await expect(h.client.workoutCount()).rejects.toMatchObject({ kind: "unexpected_reply" });
    await expect(h.client.workoutCount()).rejects.toMatchObject({ kind: "unexpected_reply" });
  });
});

describe("20.0 AC11 — retries", () => {
  it("a GET answered 503, 503, 200 resolves after waits of 1000 then 2000", async () => {
    const h = harness([jsonReply({}, { status: 503 }), jsonReply({}, { status: 503 }), jsonReply({ workout_count: 1 })]);
    await expect(h.client.workoutCount()).resolves.toBe(1);
    expect(h.sleeps).toEqual([1000, 2000]);
    expect(h.calls).toHaveLength(3);
  });

  it("four 429s reject rate_limited after waits of 1000, 2000, 4000", async () => {
    const h = harness([429, 429, 429, 429].map((status) => jsonReply({}, { status })));
    await expect(h.client.workoutCount()).rejects.toMatchObject({ kind: "rate_limited", status: 429 });
    expect(h.sleeps).toEqual([1000, 2000, 4000]);
    expect(h.calls).toHaveLength(4);
  });

  it("a 429 with Retry-After 9 waits the longer 9 s and holds the pacer back", async () => {
    const h = harness([jsonReply({}, { status: 429, headers: { "retry-after": "9" } }), jsonReply({ workout_count: 1 })]);
    const defer = vi.spyOn(h.pacer, "deferUntil");
    await expect(h.client.workoutCount()).resolves.toBe(1);
    expect(h.sleeps).toEqual([9000]);
    expect(defer).toHaveBeenCalledTimes(1);
  });

  it("a fetch rejection is retried, then rejects network", async () => {
    const h = harness([new TypeError("Failed to fetch"), new TypeError("Failed to fetch"), new TypeError("Failed to fetch"), new TypeError("Failed to fetch")]);
    await expect(h.client.userInfo()).rejects.toMatchObject({ kind: "network", status: null });
    expect(h.calls).toHaveLength(4);
  });

  it.each([
    ["POST 503", (c: ReturnType<typeof createHevyClient>) => c.createWorkout(POST), jsonReply({}, { status: 503 }), "server"],
    ["PUT 503", (c: ReturnType<typeof createHevyClient>) => c.updateWorkout("x", POST), jsonReply({}, { status: 503 }), "server"],
    ["POST rejected by fetch", (c: ReturnType<typeof createHevyClient>) => c.createTemplate(TEMPLATE), new TypeError("Failed to fetch"), "network"],
  ] as const)("%s is never retried", async (_n, call, reply, kind) => {
    const h = harness([reply]);
    await expect(call(h.client)).rejects.toMatchObject({ kind });
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it("an abort during a retry wait rejects at once with aborted", async () => {
    const ac = new AbortController();
    const h = harness([jsonReply({}, { status: 503 }), jsonReply({ workout_count: 1 })]);
    const p = h.client.workoutCount(ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
    expect(h.calls.length).toBeLessThanOrEqual(1);
  });

  it("a 403 limit and a 401 are not retried", async () => {
    const h = harness([jsonReply({ error: "exceeds-custom-exercise-limit" }, { status: 403 }), jsonReply({ error: "nope" }, { status: 401 })]);
    await expect(h.client.createTemplate(TEMPLATE)).rejects.toMatchObject({ kind: "limit" });
    await expect(h.client.userInfo()).rejects.toMatchObject({ kind: "bad_key" });
    expect(h.calls).toHaveLength(2);
  });
});

describe("20.0 AC10 — one pacer for every client", () => {
  it("two clients over one pacer, called at the same instant, start 600 ms apart", async () => {
    let now = Date.parse("2026-10-28T12:30:00.000Z");
    const starts: number[] = [];
    const pacer = createPacer({
      now: () => now,
      sleep: async (ms) => {
        const wake = now + ms;
        await Promise.resolve();
        now = Math.max(now, wake);
      },
    });
    const deps = (): HevyClientDeps => ({
      fetch: (async () => {
        starts.push(now);
        return jsonReply({ workout_count: 1 });
      }) as unknown as typeof fetch,
      getKey: () => KEY,
      pacer,
      sleep: async () => {},
      now: () => now,
    });
    await Promise.all([createHevyClient(deps()).workoutCount(), createHevyClient(deps()).workoutCount()]);
    expect(starts[1]! - starts[0]!).toBe(600);
  });
});
