import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { METRIC_NAMES } from "../../src/telemetry/views.js";

/** Spec 13.0 AC14 — every ops/ file parses; dashboards/alerts only query names the API exports. */
const root = fileURLToPath(new URL("../../../../ops/", import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const files = walk(root);
const KNOWN = Object.values(METRIC_NAMES);
// Label names that share a metric prefix (the runtime Views keep them, views.ts).
const LABELS = new Set(["v8js_gc_type", "v8js_heap_space_name"]);
const metricNamesIn = (text: string) =>
  [...text.matchAll(/\b((?:http_server|nodejs|v8js|sin|k6)_[a-z0-9_]+)\b/g)]
    .map((m) => m[1]!)
    .filter((n) => !LABELS.has(n));
const base = (n: string) => n.replace(/_(bucket|count|sum|total)$/, "");
/**
 * Spec 16 AC26 — the names k6 2.3's Prometheus remote-write output gives the load test's metrics, with
 * `K6_PROMETHEUS_RW_TREND_STATS=p(95),max` (read from a real run, 2026-11-14). Only load-test.json may use them.
 */
const K6_NAMES = ["k6_vus", "k6_http_reqs_total", "k6_http_req_duration_p95", "k6_server_errors_rate", "k6_rate_limited_total"];
const LOAD_TEST = "grafana/dashboards/load-test.json";
const allowed = (file: string, n: string) =>
  (KNOWN as readonly string[]).includes(base(n)) || (file.endsWith(LOAD_TEST) && K6_NAMES.includes(n));

describe("AC14 — ops/ config parses", () => {
  it.each(files.filter((f) => f.endsWith(".json")))("%s is valid JSON", (f) => {
    expect(() => JSON.parse(readFileSync(f, "utf8"))).not.toThrow();
  });
  it.each(files.filter((f) => /\.ya?ml$/.test(f)))("%s is valid YAML", (f) => {
    expect(() => parseYaml(readFileSync(f, "utf8"))).not.toThrow();
  });
  it("dashboards and alerts query only exported metric names (k6's only in load-test.json, Spec 16 AC26)", () => {
    const used = files
      .filter((f) => f.includes("/grafana/dashboards/") || f.includes("/grafana/alerts/"))
      .flatMap((f) => metricNamesIn(readFileSync(f, "utf8")).map((n) => [f, n] as const));
    expect(used.length).toBeGreaterThan(0);
    for (const [f, n] of used) expect(allowed(f, n), `${n} in ${f}`).toBe(true);
  });
  it("every alert rule treats no data as OK (§6.8)", () => {
    const doc = parseYaml(readFileSync(join(root, "grafana/alerts/api.yaml"), "utf8")) as {
      groups: { rules: { uid: string; noDataState: string }[] }[];
    };
    const rules = doc.groups.flatMap((g) => g.rules);
    expect(rules.map((r) => r.uid).sort()).toEqual(["api-event-loop-blocked", "api-high-error-rate", "api-slow"]);
    for (const r of rules) expect(r.noDataState, r.uid).toBe("OK");
  });
});

describe("Spec 16 AC26 — the Load test dashboard", () => {
  const text = readFileSync(join(root, LOAD_TEST), "utf8");
  const dashboard = JSON.parse(text) as {
    uid: string;
    templating: { list: { name: string; type: string; query?: string }[] };
    panels: { type: string; title: string; targets?: { expr: string }[] }[];
  };
  const exprs = dashboard.panels.flatMap((p) => (p.targets ?? []).map((t) => t.expr));

  it("puts k6's load next to the server's own health and Spec 13.3's CPU and pool", () => {
    const used = new Set(metricNamesIn(text));
    for (const name of K6_NAMES) expect(used, name).toContain(name);
    for (const name of [METRIC_NAMES.processCpu, METRIC_NAMES.dbPoolConnections, METRIC_NAMES.dbPoolWaiting]) {
      expect(new Set([...used].map(base)), name).toContain(name);
    }
    for (const name of ["http_server_request_duration_seconds", "nodejs_eventloop_delay_p99_seconds", "v8js_memory_heap_used_bytes"]) {
      expect(new Set([...used].map(base)), name).toContain(name);
    }
  });

  it("draws set-save p95 against a 2 s line", () => {
    expect(exprs).toContain('max by (step) (k6_http_req_duration_p95{name="set_save"})');
    expect(exprs).toContain("vector(2)");
  });

  it("every rate() window is $__rate_interval, and it has the datasource and cpu_limit variables", () => {
    const windows = [...text.matchAll(/(?:rate|increase)\([^[]*\[([^\]]+)\]/g)].map((m) => m[1]);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) expect(w).toBe("$__rate_interval");
    expect(dashboard.templating.list.map((v) => v.name)).toEqual(["datasource", "cpu_limit"]);
    expect(dashboard.uid).toBe("sin-load-test");
  });
});

describe("Spec 16 AC25 — every dashboard shows the load-test runs", () => {
  it.each(files.filter((f) => f.includes("/grafana/dashboards/") && f.endsWith(".json")))("%s has the loadtest annotation", (f) => {
    const doc = JSON.parse(readFileSync(f, "utf8")) as {
      annotations?: { list: { name: string; datasource?: { uid?: string }; target?: { type?: string; tags?: string[] } }[] };
    };
    expect(doc.annotations?.list).toContainEqual(
      expect.objectContaining({
        name: "Load test runs",
        datasource: { type: "grafana", uid: "-- Grafana --" },
        target: expect.objectContaining({ type: "tags", tags: ["loadtest"] }),
      }),
    );
  });
});

describe("Spec 13.3 AC12 — api-overview shows CPU and the DB pool", () => {
  const text = readFileSync(join(root, "grafana/dashboards/api-overview.json"), "utf8");
  const dashboard = JSON.parse(text) as { templating: { list: { name: string; type: string; query?: string }[] } };

  it("queries every Spec 13.3 metric", () => {
    const used = new Set(metricNamesIn(text).map(base));
    for (const name of [
      METRIC_NAMES.processCpu,
      METRIC_NAMES.cpuThrottled,
      METRIC_NAMES.dbPoolConnections,
      METRIC_NAMES.dbPoolWaiting,
      METRIC_NAMES.dbPoolLimit,
      METRIC_NAMES.dbPoolWaitSeconds,
      METRIC_NAMES.dbPoolWaits,
    ]) {
      expect(used, name).toContain(name);
    }
  });

  // Final review: staging pushes OTLP every 60 s, so a fixed [1m] window holds one sample and rate() shows no data;
  // $__rate_interval scales with the data source's interval, as every older panel here does.
  it("every rate() window is $__rate_interval", () => {
    const windows = [...text.matchAll(/rate\([^[]*\[([^\]]+)\]/g)].map((m) => m[1]);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) expect(w).toBe("$__rate_interval");
  });

  it("has a cpu_limit textbox defaulting to Render free's 0.1", () => {
    expect(dashboard.templating.list.find((v) => v.name === "cpu_limit")).toMatchObject({ type: "textbox", query: "0.1" });
  });
});
