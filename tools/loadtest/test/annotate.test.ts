import { describe, expect, it } from "vitest";
import { closeAnnotation, openAnnotation } from "../src/node/annotate.ts";
import { ANNOTATION_SECRETS, secretsFrom } from "../src/node/env.ts";

const s = secretsFrom({ GRAFANA_URL: "https://stack.grafana.example.test", GRAFANA_ANNOTATION_TOKEN: "glsa_annotation_secret" }, ANNOTATION_SECRETS);

function fakeGrafana(status: (method: string) => number | Error) {
  const calls: { method: string; url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: new Headers(init?.headers).get("authorization") });
    const st = status(method);
    if (st instanceof Error) throw st;
    return Response.json(method === "POST" ? { id: 42, message: "Annotation added" } : { message: "ok" }, { status: st });
  }) as unknown as typeof fetch;
  const warnings: string[] = [];
  return { fetchFn, calls, warnings, warn: (l: string) => void warnings.push(l) };
}

describe("AC25 — each run leaves an annotation", () => {
  it("opens with a POST tagged loadtest, the target and the type, at the run's start", async () => {
    const g = fakeGrafana(() => 200);
    const id = await openAnnotation(s, { target: "staging", type: "gym", startMs: 1_800_000_000_000 }, g.fetchFn, g.warn);
    expect(id).toBe(42);
    expect(g.calls[0]).toMatchObject({
      method: "POST",
      url: "https://stack.grafana.example.test/api/annotations",
      body: { time: 1_800_000_000_000, tags: ["loadtest", "staging", "gym"], text: "load test: gym run on staging" },
      auth: "Bearer glsa_annotation_secret",
    });
    expect(g.warnings).toEqual([]);
  });

  it("closes with a PATCH carrying timeEnd and the end text (N on a gym run)", async () => {
    const g = fakeGrafana(() => 200);
    await closeAnnotation(s, 42, { endMs: 1_800_000_360_000, text: "staging handles 50 lifters … (N = 50)" }, g.fetchFn, g.warn);
    expect(g.calls[0]).toMatchObject({
      method: "PATCH",
      url: "https://stack.grafana.example.test/api/annotations/42",
      body: { timeEnd: 1_800_000_360_000, text: "staging handles 50 lifters … (N = 50)" },
    });
  });

  it("a failed open warns once, returns no id, and closing nothing does nothing", async () => {
    const g = fakeGrafana(() => 500);
    const id = await openAnnotation(s, { target: "staging", type: "burst", startMs: 1 }, g.fetchFn, g.warn);
    expect(id).toBeUndefined();
    expect(g.warnings).toEqual(["Grafana annotation: opening the run annotation failed (HTTP 500); the run goes on"]);
    await closeAnnotation(s, undefined, { endMs: 2, text: "x" }, g.fetchFn, g.warn);
    expect(g.calls).toHaveLength(1);
  });

  it("Review Focus 4 — open OK, close 500: one warning naming the step, never the token", async () => {
    const g = fakeGrafana((m) => (m === "PATCH" ? 500 : 200));
    const id = await openAnnotation(s, { target: "staging", type: "gym", startMs: 1 }, g.fetchFn, g.warn);
    await closeAnnotation(s, id, { endMs: 2, text: "x" }, g.fetchFn, g.warn);
    expect(g.warnings).toEqual(["Grafana annotation: closing the run annotation failed (HTTP 500); the run goes on"]);
    expect(g.warnings.join(" ")).not.toContain("glsa_annotation_secret");
  });

  it("a network error never throws", async () => {
    const g = fakeGrafana(() => new TypeError("fetch failed"));
    await expect(openAnnotation(s, { target: "prod", type: "gym", startMs: 1 }, g.fetchFn, g.warn)).resolves.toBeUndefined();
    await expect(closeAnnotation(s, 7, { endMs: 2, text: "x" }, g.fetchFn, g.warn)).resolves.toBeUndefined();
    expect(g.warnings).toEqual([
      "Grafana annotation: opening the run annotation failed (network error); the run goes on",
      "Grafana annotation: closing the run annotation failed (network error); the run goes on",
    ]);
  });
});
