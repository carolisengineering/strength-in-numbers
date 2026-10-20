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
  [...text.matchAll(/\b((?:http_server|nodejs|v8js|sin)_[a-z0-9_]+)\b/g)]
    .map((m) => m[1]!)
    .filter((n) => !LABELS.has(n));
const base = (n: string) => n.replace(/_(bucket|count|sum|total)$/, "");

describe("AC14 — ops/ config parses", () => {
  it.each(files.filter((f) => f.endsWith(".json")))("%s is valid JSON", (f) => {
    expect(() => JSON.parse(readFileSync(f, "utf8"))).not.toThrow();
  });
  it.each(files.filter((f) => /\.ya?ml$/.test(f)))("%s is valid YAML", (f) => {
    expect(() => parseYaml(readFileSync(f, "utf8"))).not.toThrow();
  });
  it("dashboards and alerts query only exported metric names", () => {
    const used = files
      .filter((f) => f.includes("/grafana/dashboards/") || f.includes("/grafana/alerts/"))
      .flatMap((f) => metricNamesIn(readFileSync(f, "utf8")));
    expect(used.length).toBeGreaterThan(0);
    for (const n of used) expect(KNOWN, n).toContain(base(n));
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
