import { describe, expect, it } from "vitest";
import { report, stepResults, type StepResult } from "../src/plan/report.ts";

/** A k6 `handleSummary` data object with the per-step submetrics the thresholds create (hand-written fixture). */
function summary(steps: { p95?: number; errorRate?: number; limited?: number }[]): unknown {
  const metrics: Record<string, unknown> = {};
  steps.forEach((s, i) => {
    const k = i + 1;
    if (s.p95 !== undefined) {
      metrics[`http_req_duration{name:set_save,phase:measure,step:${k}}`] = {
        type: "trend",
        contains: "time",
        values: { avg: s.p95 / 2, "p(95)": s.p95, max: s.p95 * 1.5 },
        thresholds: { "p(95)<2000": { ok: s.p95 < 2000 } },
      };
    }
    if (s.errorRate !== undefined) {
      metrics[`server_errors{phase:measure,step:${k}}`] = { type: "rate", contains: "default", values: { rate: s.errorRate } };
      metrics[`rate_limited{phase:measure,step:${k}}`] = { type: "counter", contains: "default", values: { count: s.limited ?? 0, rate: 0 } };
    }
  });
  return { metrics, state: { testRunDurationMs: 1 } };
}

const LIFTERS = [25, 50, 75, 100];

describe("stepResults", () => {
  it("reads p95, error rate and 429 count per step from the summary", () => {
    const steps = stepResults(summary([{ p95: 300, errorRate: 0 }, { p95: 2500, errorRate: 0.02, limited: 3 }]), [10, 25], "gym");
    expect(steps).toEqual<StepResult[]>([
      { step: 1, lifters: 10, measured: true, p95Ms: 300, errorRate: 0, rateLimited: 0, pass: true, failedOn: null },
      { step: 2, lifters: 25, measured: true, p95Ms: 2500, errorRate: 0.02, rateLimited: 3, pass: false, failedOn: "set-save p95 over 2 s" },
    ]);
  });

  it("a step whose submetrics are missing is not measured and does not pass", () => {
    const [s] = stepResults(summary([{}]), [10], "gym");
    expect(s).toMatchObject({ measured: false, pass: false });
  });

  it("a burst step is judged on 5xx and 429 only (it has no set saves)", () => {
    const [s] = stepResults(summary([{ errorRate: 0 }]), [10], "burst");
    expect(s).toMatchObject({ measured: true, p95Ms: null, pass: true });
  });
});

describe("AC8 — N is reported as the owner's sentence", () => {
  it("monotonic: N is the highest passing step, X the next step's first failure", () => {
    const steps = stepResults(
      summary([
        { p95: 400, errorRate: 0 },
        { p95: 700, errorRate: 0 },
        { p95: 1500, errorRate: 0.001 },
        { p95: 2600, errorRate: 0 },
      ]),
      LIFTERS,
      "gym",
    );
    expect(report({ target: "local", type: "gym", pushFactor: 1, steps })).toEqual({
      n: 75,
      x: "set-save p95 over 2 s",
      nonMonotonic: false,
      sentence: "local handles 75 lifters mid-workout at the same time before set-save p95 over 2 s goes wrong",
    });
  });

  it("X names the first threshold that failed: 5xx before 429", () => {
    const steps = stepResults(summary([{ p95: 400, errorRate: 0 }, { p95: 400, errorRate: 0.05, limited: 2 }]), [10, 25], "gym");
    expect(report({ target: "staging", type: "gym", pushFactor: 1, steps }).x).toBe("5xx rate over 1%");
    const limited = stepResults(summary([{ p95: 400, errorRate: 0 }, { p95: 400, errorRate: 0, limited: 1 }]), [10, 25], "gym");
    expect(report({ target: "staging", type: "gym", pushFactor: 1, steps: limited }).x).toBe("a rate-limited request (429)");
  });

  it("non-monotonic: says so instead of hiding it", () => {
    const steps = stepResults(
      summary([
        { p95: 400, errorRate: 0 },
        { p95: 2100, errorRate: 0 },
        { p95: 900, errorRate: 0 },
        { p95: 2600, errorRate: 0 },
      ]),
      LIFTERS,
      "gym",
    );
    const r = report({ target: "local", type: "gym", pushFactor: 1, steps });
    expect(r.nonMonotonic).toBe(true);
    expect(r.n).toBe(75);
    expect(r.sentence).toContain("non-monotonic");
    expect(r.sentence).toContain("50-lifter step");
  });

  it("all pass: nothing failed up to the largest step tried", () => {
    const steps = stepResults(summary([{ p95: 400, errorRate: 0 }, { p95: 500, errorRate: 0 }]), [10, 25], "gym");
    const r = report({ target: "local", type: "gym", pushFactor: 1, steps });
    expect(r).toMatchObject({ n: 25, x: "nothing failed up to the largest step tried" });
    expect(r.sentence).toBe("local handles 25 lifters mid-workout at the same time; nothing failed up to the largest step tried");
  });

  it("the first step fails: no step passed", () => {
    const steps = stepResults(summary([{ p95: 2500, errorRate: 0 }, { p95: 2600, errorRate: 0 }]), [10, 25], "gym");
    const r = report({ target: "local", type: "gym", pushFactor: 1, steps });
    expect(r.n).toBeNull();
    expect(r.sentence).toBe("local: no step passed; the first step (10 lifters) failed on set-save p95 over 2 s");
  });

  it("Review Focus 3/4 — an empty summary is 'no measured step', not N = 0", () => {
    for (const s of [undefined, {}, summary([])]) {
      const r = report({ target: "local", type: "gym", pushFactor: 1, steps: stepResults(s, [10, 25], "gym") });
      expect(r.n).toBeNull();
      expect(r.x).toBe("no measured step");
      expect(r.sentence).toBe("local: no measured step; the run ended before any step was measured");
    }
  });
});

describe("AC9 — push results are never plain N", () => {
  it("is reported as equivalent lifters at ×F pace", () => {
    const steps = stepResults(summary([{ p95: 400, errorRate: 0 }, { p95: 2400, errorRate: 0 }]), [10, 25], "push");
    const r = report({ target: "local", type: "push", pushFactor: 4, steps });
    expect(r.sentence).toBe("local handles 10 equivalent lifters at ×4 pace before set-save p95 over 2 s goes wrong");
    expect(r.sentence).not.toContain("lifters mid-workout");
  });

  it("refuses a push result with a factor of 1", () => {
    expect(() => report({ target: "local", type: "push", pushFactor: 1, steps: [] })).toThrow();
  });
});

describe("burst sentence", () => {
  it("names lifters opening the app", () => {
    const steps = stepResults(summary([{ errorRate: 0 }, { errorRate: 0.2 }]), [10, 20], "burst");
    expect(report({ target: "local", type: "burst", pushFactor: 1, steps }).sentence).toBe(
      "local handles 10 lifters opening the app within a minute before 5xx rate over 1% goes wrong",
    );
  });
});
