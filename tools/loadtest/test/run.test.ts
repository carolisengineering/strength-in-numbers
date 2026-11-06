import { describe, expect, it, vi } from "vitest";
import type { RunCommand } from "../src/node/args.ts";
import { runLoad, type RunDeps } from "../src/node/run.ts";
import type { Api } from "../src/node/api.ts";
import { summary } from "./k6-summary.ts";

const TOKEN = "eyJ-secret-token";

/** A k6 summary (real 2.3.0 shape) in which every step passed. */
const passingSummary = (steps: number): unknown => summary(Array.from({ length: steps }, () => ({ p95: 300, errorRate: 0 })));

function deps(overrides: Partial<RunDeps> = {}) {
  const lines: string[] = [];
  const results: { name: string; body: Record<string, unknown> }[] = [];
  let sigint: (() => void) | undefined;
  const api: Api = {
    get: async (path) =>
      path === "/v1/routines"
        ? { status: 200, body: { routines: [{ id: "0190f6c2-2222-7000-8000-000000000001", name: "Load test — strength session" }] } }
        : { status: 200, body: { commit: "abc123" } },
    post: async () => ({ status: 201, body: {} }),
    patch: async () => ({ status: 200, body: {} }),
    del: async () => ({ status: 204 }),
  };
  const d: RunDeps = {
    spawnK6: vi.fn(() => ({ exited: Promise.resolve({ code: 0, signal: null }), kill: vi.fn() })),
    tokens: vi.fn(async (ids: string[]) => ids.map(() => TOKEN)),
    apisFor: vi.fn((tokens: string[]) => tokens.map(() => api)),
    cleanupAll: vi.fn(async () => ({ removed: 7 })),
    writeResult: vi.fn((name: string, body: Record<string, unknown>) => void results.push({ name, body })),
    readSummary: vi.fn(() => passingSummary(3)),
    latestGymResult: vi.fn(() => undefined),
    commit: vi.fn(async () => "abc123"),
    onSigint: vi.fn((handler: () => void) => {
      sigint = handler;
      return () => {
        sigint = undefined;
      };
    }),
    now: () => new Date("2026-11-06T12:00:00.000Z"),
    log: (line: string) => void lines.push(line),
    ...overrides,
  };
  return { d, lines, results, fireSigint: () => sigint?.() };
}

const gym: RunCommand = {
  cmd: "run",
  type: "gym",
  target: "local",
  dryRun: false,
  push: 1,
  allowUnpassedPush: false,
  metricsOutput: true,
  lifters: 3,
  steps: [1, 2, 3],
  holdScale: 0.05,
};

describe("AC16 — cleanup runs even when the run does not finish", () => {
  it("after a normal exit", async () => {
    const { d } = deps();
    expect(await runLoad(gym, d)).toBe(0);
    expect(d.cleanupAll).toHaveBeenCalledTimes(1);
  });

  it("after a failed threshold (k6 exit 99)", async () => {
    const { d } = deps({ spawnK6: vi.fn(() => ({ exited: Promise.resolve({ code: 99, signal: null }), kill: vi.fn() })) });
    await runLoad(gym, d);
    expect(d.cleanupAll).toHaveBeenCalledTimes(1);
  });

  it("when spawning k6 fails", async () => {
    const { d } = deps({
      spawnK6: vi.fn(() => ({ exited: Promise.reject(new Error("spawn k6 ENOENT")), kill: vi.fn() })),
    });
    await expect(runLoad(gym, d)).rejects.toThrow("ENOENT");
    expect(d.cleanupAll).toHaveBeenCalledTimes(1);
  });

  it("after Ctrl-C: forwards SIGINT to k6, waits for it, then cleans up", async () => {
    let resolveExit!: (v: { code: number | null; signal: string | null }) => void;
    const kill = vi.fn(() => resolveExit({ code: null, signal: "SIGINT" }));
    const h = deps({
      spawnK6: vi.fn(() => ({ exited: new Promise<{ code: number | null; signal: string | null }>((r) => (resolveExit = r)), kill })),
      readSummary: vi.fn(() => undefined),
    });
    const done = runLoad(gym, h.d);
    await vi.waitFor(() => expect(h.d.spawnK6).toHaveBeenCalled());
    h.fireSigint();
    await done;
    expect(kill).toHaveBeenCalledWith("SIGINT");
    expect(h.d.cleanupAll).toHaveBeenCalledTimes(1);
  });
});

describe("final review — a failed cleanup never loses the run's result", () => {
  it("still reads the summary, writes the result with cleanup: failed, and says so", async () => {
    const { d, results, lines } = deps({ cleanupAll: vi.fn(async () => Promise.reject(new Error("DELETE /v1/workouts/{id} answered 429"))) });
    expect(await runLoad(gym, d)).toBe(1);
    expect(d.readSummary).toHaveBeenCalled();
    expect(results[0]!.body).toMatchObject({ status: "complete", cleanup: "failed", n: 3 });
    expect(lines.join("\n")).toContain("cleanup failed: DELETE /v1/workouts/{id} answered 429");
    expect(lines.join("\n")).toContain("loadtest cleanup --target local");
  });

  it("a clean run records cleanup: done", async () => {
    const { d, results } = deps();
    await runLoad(gym, d);
    expect(results[0]!.body).toMatchObject({ cleanup: "done" });
  });
});

describe("AC8 / Review Focus 3–4 — an empty summary", () => {
  it("writes an incomplete result and reports no measured step, after cleanup", async () => {
    const { d, results, lines } = deps({ readSummary: vi.fn(() => undefined) });
    expect(await runLoad(gym, d)).toBe(1);
    expect(d.cleanupAll).toHaveBeenCalledTimes(1);
    expect(results[0]!.body).toMatchObject({ status: "incomplete", n: null, x: "no measured step" });
    expect(lines.join("\n")).toContain("no measured step");
  });
});

describe("final review — Ctrl-C before the first measured step (Review Focus 3)", () => {
  it("k6's zero-filled summary is an incomplete run with no measured step, never 'handles N'", async () => {
    const { d, results, lines } = deps({ readSummary: vi.fn(() => summary([{}, {}, {}])) });
    expect(await runLoad(gym, d)).toBe(1);
    expect(d.cleanupAll).toHaveBeenCalledTimes(1);
    expect(results[0]!.body).toMatchObject({ status: "incomplete", n: null, x: "no measured step" });
    expect(lines.join("\n")).not.toContain("handles");
  });
});

describe("final review — interrupted after step 1", () => {
  it("keeps step 1's honest N but marks the run incomplete", async () => {
    const { d, results } = deps({ readSummary: vi.fn(() => summary([{ p95: 300, errorRate: 0 }, {}, {}])) });
    expect(await runLoad(gym, d)).toBe(1);
    expect(results[0]!.body).toMatchObject({ status: "incomplete", n: 1 });
  });
});

describe("result file and sentence", () => {
  it("names the file by time, target and type, and records the run", async () => {
    const { d, results, lines } = deps();
    await runLoad(gym, d);
    expect(results[0]!.name).toBe("2026-11-06T12-00-00-000Z-local-gym.json");
    expect(results[0]!.body).toMatchObject({
      target: "local",
      type: "gym",
      commit: "abc123",
      pushFactor: 1,
      status: "complete",
      n: 3,
      nonMonotonic: false,
      window: { start: "2026-11-06T12:00:00.000Z", end: "2026-11-06T12:00:00.000Z" },
    });
    expect(lines).toContain("local handles 3 lifters mid-workout at the same time; nothing failed up to the largest step tried");
  });
});

describe("D9 — push runs need a passing gym run first", () => {
  const push: RunCommand = { ...gym, type: "push", push: 4 };

  it("refuses with exit 2 when there is none", async () => {
    const { d, lines } = deps();
    expect(await runLoad(push, d)).toBe(2);
    expect(lines).toContain("push needs a passing gym run on local first (or --allow-unpassed-push)");
    expect(d.tokens).not.toHaveBeenCalled();
  });

  it("refuses when the newest gym run passed no step", async () => {
    const { d } = deps({ latestGymResult: vi.fn(() => ({ n: null })) });
    expect(await runLoad(push, d)).toBe(2);
  });

  it("runs after a passing gym run, or with the override", async () => {
    expect(await runLoad(push, deps({ latestGymResult: vi.fn(() => ({ n: 25 })) }).d)).toBe(0);
    expect(await runLoad({ ...push, allowUnpassedPush: true }, deps().d)).toBe(0);
  });
});

describe("--dry-run", () => {
  it("prints the estimate and touches nothing", async () => {
    const { d, lines } = deps();
    expect(await runLoad({ ...gym, dryRun: true }, d)).toBe(0);
    expect(lines.some((l) => /^estimated requests: \d+$/.test(l))).toBe(true);
    expect(d.tokens).not.toHaveBeenCalled();
    expect(d.spawnK6).not.toHaveBeenCalled();
    expect(d.cleanupAll).not.toHaveBeenCalled();
  });
});

describe("secrets stay out of argv and logs", () => {
  it("tokens travel in LOADTEST_LIFTERS only", async () => {
    const { d, lines } = deps();
    await runLoad(gym, d);
    const [args, env] = (d.spawnK6 as ReturnType<typeof vi.fn>).mock.calls[0]! as [string[], Record<string, string>];
    expect(JSON.parse(env.LOADTEST_LIFTERS!)).toHaveLength(3);
    expect(env.LOADTEST_LIFTERS).toContain(TOKEN);
    for (const a of args) expect(a).not.toContain(TOKEN);
    for (const l of lines) expect(l).not.toContain(TOKEN);
  });

  it("local runs send k6 metrics to local Prometheus unless --no-metrics-output", async () => {
    const on = deps();
    await runLoad(gym, on.d);
    const [args, env] = (on.d.spawnK6 as ReturnType<typeof vi.fn>).mock.calls[0]! as [string[], Record<string, string>];
    expect(args).toContain("experimental-prometheus-rw");
    expect(env.K6_PROMETHEUS_RW_SERVER_URL).toBe("http://localhost:9090/api/v1/write");
    const off = deps();
    await runLoad({ ...gym, metricsOutput: false }, off.d);
    expect((off.d.spawnK6 as ReturnType<typeof vi.fn>).mock.calls[0]![0]).not.toContain("experimental-prometheus-rw");
  });
});
