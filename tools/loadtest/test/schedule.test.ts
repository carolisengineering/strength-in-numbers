import { describe, expect, it } from "vitest";
import { BURST_STEPS, BURST_WINDOW_S, GYM_STEPS, MIN_SAVES_PER_STEP, RAMP_S } from "../src/plan/constants.ts";
import { seededRoutineSets } from "../src/plan/routine.ts";
import {
  burstOffset,
  burstSchedule,
  estimateRequests,
  gymSchedule,
  meanSessionS,
  meanSetCycleS,
  stepAt,
  toK6Scenario,
} from "../src/plan/schedule.ts";
import { createRng } from "../src/plan/rng.ts";

const SETS = seededRoutineSets();

describe("AC12 — the ramp is long enough to mean something", () => {
  const s = gymSchedule([...GYM_STEPS], SETS);

  it("one stage per step, in order", () => {
    expect(s.stages.map((st) => st.lifters)).toEqual([...GYM_STEPS]);
    for (const st of s.stages) expect(st.rampS).toBe(RAMP_S);
  });

  it("every hold reaches MIN_SAVES_PER_STEP expected set saves and lasts one mean session", () => {
    for (const st of s.stages) {
      expect((st.lifters * st.holdS) / meanSetCycleS(1), `${st.lifters} lifters`).toBeGreaterThanOrEqual(MIN_SAVES_PER_STEP);
      expect(st.holdS, `${st.lifters} lifters`).toBeGreaterThanOrEqual(meanSessionS(SETS, 1));
    }
  });

  it("a push run's holds use the shortened session", () => {
    const push = gymSchedule([10, 25], SETS, 4);
    expect(meanSessionS(SETS, 4)).toBeLessThan(meanSessionS(SETS, 1));
    for (const st of push.stages) expect(st.holdS).toBeGreaterThanOrEqual(meanSessionS(SETS, 4));
  });
});

describe("AC14 — the burst arrives within about a minute", () => {
  const s = burstSchedule([...BURST_STEPS]);

  it("five stages, one per step", () => {
    expect(s.stages.map((st) => st.lifters)).toEqual([10, 20, 30, 50, 100]);
    const scenarios = toK6Scenario(s, "burst") as Record<string, { executor: string; vus: number; iterations: number }>;
    expect(Object.keys(scenarios)).toHaveLength(5);
    for (const [i, sc] of Object.values(scenarios).entries()) {
      expect(sc).toMatchObject({ executor: "per-vu-iterations", vus: BURST_STEPS[i], iterations: 1 });
    }
  });

  it("every lifter's offset is inside the window", () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const o = burstOffset(createRng(seed), BURST_WINDOW_S);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(BURST_WINDOW_S);
    }
  });

  it("burst scenarios start one after another, each after a quiet gap", () => {
    const scenarios = Object.values(toK6Scenario(s, "burst") as Record<string, { startTime: string }>);
    const starts = scenarios.map((sc) => Number(sc.startTime.replace("s", "")));
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]!).toBeGreaterThan(starts[i - 1]! + BURST_WINDOW_S);
  });
});

describe("AC10 — phases from elapsed time", () => {
  const s = gymSchedule([10, 25], SETS);
  const [a, b] = s.stages;

  it("before the scenario starts it is warm-up; ramps and holds follow", () => {
    expect(stepAt(s, -1)).toEqual({ step: "warmup", phase: "warmup" });
    expect(stepAt(s, 0)).toEqual({ step: "ramp", phase: "ramp" });
    expect(stepAt(s, (a!.rampS + 1) * 1000)).toEqual({ step: "1", phase: "measure" });
    expect(stepAt(s, (a!.rampS + a!.holdS + 1) * 1000)).toEqual({ step: "ramp", phase: "ramp" });
    expect(stepAt(s, (a!.rampS + a!.holdS + b!.rampS + 1) * 1000)).toEqual({ step: "2", phase: "measure" });
  });

  it("after the last hold it is ramp-down, never a measured step", () => {
    const end = s.stages.reduce((t, st) => t + st.rampS + st.holdS, 0);
    expect(stepAt(s, (end + 5) * 1000).phase).not.toBe("measure");
  });
});

describe("toK6Scenario — gym and push", () => {
  it("one ramping-vus scenario: ramp then hold per step", () => {
    const s = gymSchedule([10, 25], SETS);
    const sc = toK6Scenario(s, "gym") as { lifters: { executor: string; stages: { duration: string; target: number }[] } };
    expect(sc.lifters.executor).toBe("ramping-vus");
    expect(sc.lifters.stages).toEqual([
      { duration: `${s.stages[0]!.rampS}s`, target: 10 },
      { duration: `${s.stages[0]!.holdS}s`, target: 10 },
      { duration: `${s.stages[1]!.rampS}s`, target: 25 },
      { duration: `${s.stages[1]!.holdS}s`, target: 25 },
    ]);
  });
});

describe("estimateRequests (the --dry-run figure)", () => {
  it("is positive, grows with lifters, and a burst counts its open-app reads", () => {
    const small = estimateRequests(gymSchedule([10], SETS), SETS, "gym");
    const big = estimateRequests(gymSchedule([10, 25], SETS), SETS, "gym");
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
    expect(estimateRequests(burstSchedule([10, 20]), SETS, "burst")).toBe(30 * 7 + 5);
  });
});
