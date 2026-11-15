import { describe, expect, it, vi } from "vitest";
import type { RunCommand } from "../src/node/args.ts";
import { gymGate, runLoad, type GymResult, type RunDeps } from "../src/node/run.ts";
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
    prodBaseUrl: () => "https://si-api-1.us-central1.run.app",
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
      flags: { steps: [1, 2, 3], holdScale: 0.05, lifters: 3 },
    });
    expect(lines).toContain("local handles 3 lifters mid-workout at the same time; nothing failed up to the largest step tried");
  });

  it("a run with only --lifters records it, so the push gate can refuse it (minor 366)", async () => {
    const { d, results } = deps({ readSummary: vi.fn(() => passingSummary(1)) });
    const lifterOnly: RunCommand = { ...gym, lifters: 3 };
    delete lifterOnly.steps;
    delete lifterOnly.holdScale;
    await runLoad(lifterOnly, d);
    expect(results[0]!.body.flags).toEqual({ steps: null, holdScale: null, lifters: 3 });
  });
});

const ok: GymResult = { n: 25, status: "complete", cleanup: "done", flags: { steps: null, holdScale: null, lifters: null } };

describe("minor 366 — gymGate", () => {
  it("refuses with no gym run", () => {
    expect(gymGate(undefined)).toBe("there is no gym run");
  });

  it("refuses an incomplete gym run", () => {
    expect(gymGate({ ...ok, status: "incomplete" })).toBe("the newest gym run is incomplete");
  });

  it("refuses a gym run whose cleanup failed: its live workouts would skew the push", () => {
    expect(gymGate({ ...ok, cleanup: "failed" })).toBe("the newest gym run's cleanup failed");
  });

  it("refuses a result file that doesn't record its flags", () => {
    expect(gymGate({ n: 25, status: "complete", cleanup: "done" })).toBe("the newest gym run doesn't record how it was run");
  });

  it("refuses a run shortened with --steps or --hold-scale", () => {
    const shortened = "the newest gym run was shortened with --steps / --hold-scale";
    expect(gymGate({ ...ok, flags: { steps: [1, 2], holdScale: null, lifters: null } })).toBe(shortened);
    expect(gymGate({ ...ok, flags: { steps: null, holdScale: 0.5, lifters: null } })).toBe(shortened);
  });

  it("refuses a run with --lifters N: a push climbs the full ladder, far past one tested step", () => {
    expect(gymGate({ ...ok, flags: { steps: null, holdScale: null, lifters: 3 } })).toBe(
      "the newest gym run used --lifters instead of the full ladder",
    );
  });

  it("refuses a run with no passing step", () => {
    expect(gymGate({ ...ok, n: null })).toBe("the newest gym run has no passing step");
  });

  it("passes a complete, unshortened run with an N", () => {
    expect(gymGate(ok)).toBeNull();
  });
});

describe("D9 — push runs need a passing gym run first", () => {
  const push: RunCommand = { ...gym, type: "push", push: 4 };

  it("refuses with exit 2 when there is none", async () => {
    const { d, lines } = deps();
    expect(await runLoad(push, d)).toBe(2);
    expect(lines).toContain("push needs a passing gym run on local first: there is no gym run (or --allow-unpassed-push)");
    expect(d.tokens).not.toHaveBeenCalled();
  });

  it("refuses an incomplete gym run (minor 366)", async () => {
    const { d, lines } = deps({ latestGymResult: vi.fn(() => ({ ...ok, status: "incomplete" })) });
    expect(await runLoad(push, d)).toBe(2);
    expect(lines).toContain("push needs a passing gym run on local first: the newest gym run is incomplete (or --allow-unpassed-push)");
    expect(d.tokens).not.toHaveBeenCalled();
  });

  it("refuses when the newest gym run passed no step", async () => {
    const { d } = deps({ latestGymResult: vi.fn(() => ({ ...ok, n: null })) });
    expect(await runLoad(push, d)).toBe(2);
  });

  it("runs after a passing gym run, or with the override", async () => {
    expect(await runLoad(push, deps({ latestGymResult: vi.fn(() => ok) }).d)).toBe(0);
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

describe("AC27 — prod guards in a run", () => {
  const prod: RunCommand = { ...gym, target: "prod", lifters: 3, steps: undefined, holdScale: undefined };
  delete prod.steps;
  delete prod.holdScale;

  it("--dry-run --target prod prints the estimate and the guard result, with no tokens and no k6", async () => {
    const { d, lines } = deps();
    expect(await runLoad({ ...prod, dryRun: true }, d)).toBe(2);
    expect(lines.some((l) => /^estimated requests: \d+$/.test(l))).toBe(true);
    expect(lines).toContain("prod runs need --confirm-prod");
    expect(d.tokens).not.toHaveBeenCalled();
    expect(d.spawnK6).not.toHaveBeenCalled();
  });

  it("a confirmed prod dry run says the guards pass and resolves the prod URL", async () => {
    const { d, lines } = deps();
    expect(await runLoad({ ...prod, dryRun: true, confirmProd: true }, d)).toBe(0);
    expect(lines).toContain("prod guards: pass (https://si-api-1.us-central1.run.app)");
    expect(d.tokens).not.toHaveBeenCalled();
  });

  it("Review Focus 5 — placeholders in prod.tfvars refuse before any token", async () => {
    const { d } = deps({
      prodBaseUrl: () => {
        throw new Error("infra/prod.tfvars still has placeholders (REPLACE_ME_…); production isn't set up yet — runbook first-deploy.md Part F");
      },
    });
    await expect(runLoad({ ...prod, confirmProd: true }, d)).rejects.toThrow(/Part F/);
    expect(d.tokens).not.toHaveBeenCalled();
  });

  it("a confirmed prod run sends k6 to the prod URL", async () => {
    const { d } = deps({ readSummary: vi.fn(() => passingSummary(1)) });
    expect(await runLoad({ ...prod, confirmProd: true }, d)).toBe(0);
    const [, env] = (d.spawnK6 as ReturnType<typeof vi.fn>).mock.calls[0]! as [string[], Record<string, string>];
    expect(env.LOADTEST_BASE_URL).toBe("https://si-api-1.us-central1.run.app");
  });
});

describe("secrets stay out of argv and logs", () => {
  it("tokens travel one per LOADTEST_LIFTER_<i> only (minor 367)", async () => {
    const { d, lines } = deps();
    await runLoad(gym, d);
    const [args, env] = (d.spawnK6 as ReturnType<typeof vi.fn>).mock.calls[0]! as [string[], Record<string, string>];
    expect(env.LOADTEST_LIFTER_COUNT).toBe("3");
    for (const i of [0, 1, 2]) {
      expect(JSON.parse(env[`LOADTEST_LIFTER_${i}`]!)).toEqual({ token: TOKEN, routineId: "0190f6c2-2222-7000-8000-000000000001" });
    }
    expect(env.LOADTEST_LIFTERS).toBeUndefined();
    for (const a of args) expect(a).not.toContain(TOKEN);
    for (const l of lines) expect(l).not.toContain(TOKEN);
  });

  it("passes k6 a run nonce and records it (minor 365)", async () => {
    const { d, results } = deps();
    await runLoad(gym, d);
    const [, env] = (d.spawnK6 as ReturnType<typeof vi.fn>).mock.calls[0]! as [string[], Record<string, string>];
    const nonce = new Date("2026-11-06T12:00:00.000Z").getTime() >>> 0;
    expect(env.LOADTEST_RUN_NONCE).toBe(String(nonce));
    expect(results[0]!.body.runNonce).toBe(nonce);
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
