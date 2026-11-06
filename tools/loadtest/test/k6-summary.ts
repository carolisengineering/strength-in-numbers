/**
 * A k6 2.3.0 `handleSummary` data object, in its real shape (final review): every threshold submetric is present
 * for every step, and a step that saw no samples has zeros (`p(95): 0`, `count: 0`, `passes: 0, fails: 0`).
 * `{}` is a step that was never reached.
 */
export function summary(steps: { p95?: number; errorRate?: number; limited?: number }[]): unknown {
  const metrics: Record<string, unknown> = {};
  steps.forEach((s, i) => {
    const k = i + 1;
    const saves = s.p95 === undefined ? 0 : 40;
    metrics[`http_req_duration{name:set_save,phase:measure,step:${k}}`] = {
      type: "trend",
      contains: "time",
      values: { avg: (s.p95 ?? 0) / 2, "p(95)": s.p95 ?? 0, max: (s.p95 ?? 0) * 1.5, count: saves },
      thresholds: { "p(95)<2000": { ok: (s.p95 ?? 0) < 2000 } },
    };
    const total = s.errorRate === undefined ? 0 : 200;
    const passes = Math.round((s.errorRate ?? 0) * total);
    metrics[`server_errors{phase:measure,step:${k}}`] = {
      type: "rate",
      contains: "default",
      values: { rate: total === 0 ? 0 : passes / total, passes, fails: total - passes },
    };
    metrics[`rate_limited{phase:measure,step:${k}}`] = { type: "counter", contains: "default", values: { count: s.limited ?? 0, rate: 0 } };
  });
  return { metrics, state: { testRunDurationMs: 1 } };
}
